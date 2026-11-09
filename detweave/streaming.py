"""Bounded, cancellable provider SSE transport; public provider text only.

Reasoning deltas are forwarded to the current caller, never added to geometry,
provenance or disk. No attempt is made to infer/decrypt unavailable reasoning.
"""
from __future__ import annotations
import http.client
import json
import socket
import threading
import time
import urllib.error
import urllib.request
from .providers import (ProviderError, request_spec, response_text, parse_response,
                        PROMPT_VERSION, MAX_RESPONSE_BYTES)
import hashlib

MAX_FRAME_BYTES = 256_000
MAX_WIRE_BYTES = 8_000_000


class RunError(ProviderError):
    def __init__(self, message, code):
        super().__init__(message)
        self.code = code


def timeouts(config):
    result = []
    for key, default, low, high in (("total_timeout_s", 600, 60, 900),
                                   ("idle_timeout_s", 90, 10, 300)):
        value = config.get(key, default)
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not low <= value <= high:
            raise RunError(f"{key} must be between {low} and {high} seconds.", "configuration")
        result.append(float(value))
    return result


class RunControl:
    """Deadline/cancellation interrupt live socket reads, including partial SSE frames."""
    def __init__(self, total_s=600, idle_s=90):
        self.started = time.monotonic()
        self.total_s, self.idle_s = total_s, idle_s
        self.last_data = None
        self.connected = False
        self.reason = None
        self._socket = None
        self._lock = threading.Lock()
        self._done = threading.Event()
        self._watcher = None

    @property
    def elapsed(self):
        return time.monotonic() - self.started

    def start(self):
        if self._watcher is None:
            self._watcher = threading.Thread(target=self._watch, daemon=True)
            self._watcher.start()

    def _watch(self):
        while not self._done.wait(0.05):
            if self.elapsed >= self.total_s:
                self.abort("total_timeout")
                break

    def register(self, sock):
        with self._lock:
            self._socket = sock
            self.connected = True
            reason = self.reason
        if reason:
            self.abort(reason)
            self.check()
        sock.settimeout(min(self.idle_s, max(0.01, self.total_s-self.elapsed)))

    def touch(self):
        self.last_data = time.monotonic()
        self.check()

    def abort(self, reason="cancelled"):
        with self._lock:
            if self.reason is None:
                self.reason = reason
            sock = self._socket
        if sock is not None:
            try:
                sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            try:
                sock.close()
            except OSError:
                pass

    def check(self):
        if self.reason is None and self.elapsed >= self.total_s:
            self.abort("total_timeout")
        if self.reason == "cancelled":
            raise RunError("请求已停止，未接受本次几何输出。", "cancelled")
        if self.reason == "total_timeout":
            raise RunError(f"达到总耗时上限（{self.total_s:g} 秒）。部分输出未作为几何接受；可调整总时限或思考模式后重试。", "total_timeout")
        if self.reason:
            raise RunError("请求连接已终止。", self.reason)

    def finish(self):
        self._done.set()
        if self._watcher and self._watcher is not threading.current_thread():
            self._watcher.join(timeout=0.2)


class ControlledHTTP(http.client.HTTPConnection):
    def __init__(self, *args, control, **kwargs):
        self.control = control
        super().__init__(*args, **kwargs)

    def connect(self):
        super().connect()
        self.control.register(self.sock)


class ControlledHTTPS(http.client.HTTPSConnection):
    def __init__(self, *args, control, **kwargs):
        self.control = control
        super().__init__(*args, **kwargs)

    def connect(self):
        super().connect()
        self.control.register(self.sock)


class HTTPHandler(urllib.request.HTTPHandler):
    def __init__(self, control):
        super().__init__()
        self.control = control

    def http_open(self, req):
        return self.do_open(lambda *a, **k: ControlledHTTP(*a, control=self.control, **k), req)


class HTTPSHandler(urllib.request.HTTPSHandler):
    def __init__(self, control):
        super().__init__()
        self.control = control

    def https_open(self, req):
        return self.do_open(lambda *a, **k: ControlledHTTPS(*a, control=self.control, **k), req,
                            context=self._context)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # never forward an API key to another endpoint


def safe_usage(value, depth=0):
    if not isinstance(value, dict) or depth > 2:
        return {}
    import math
    result = {}
    for key, item in value.items():
        if not isinstance(key, str) or len(key) > 64 or not key.replace('_', '').isalnum():
            continue
        if isinstance(item, (int, float)) and not isinstance(item, bool) and math.isfinite(item):
            result[key] = item
        elif isinstance(item, dict):
            result[key] = safe_usage(item, depth+1)
    return result


class Assembler:
    """One completion only. Partial/truncated JSON is never promoted to a model."""
    def __init__(self, kind, emit):
        self.kind, self.emit = kind, emit
        self.parts = []
        self.output_bytes = self.reasoning_bytes = 0
        self.usage = {}
        self.model = None
        self.finish_reason = None
        self.terminal = False

    def append(self, type_, value):
        if value is None or value == "":
            return
        if not isinstance(value, str):
            raise RunError("服务商返回了不支持的文本片段格式。", "protocol_error")
        size = len(value.encode('utf-8'))
        if type_ == "output":
            if self.finish_reason is not None:
                raise RunError("完成标记后仍收到内容，未接受输出。", "protocol_error")
            self.output_bytes += size
            self.parts.append(value)
        else:
            self.reasoning_bytes += size
        if max(self.output_bytes, self.reasoning_bytes) > MAX_RESPONSE_BYTES:
            raise RunError("模型输出超过大小上限。", "response_limit")
        self.emit(dict(type=type_, text=value))

    def metadata(self, model=None, usage=None):
        changed = False
        if isinstance(model, str) and model != self.model:
            self.model = model[:200]
            changed = True
        if isinstance(usage, dict):
            self.usage.update(safe_usage(usage))
            changed = True
        if changed:
            self.emit(dict(type="usage", usage=self.usage.copy(), response_model=self.model))

    def feed(self, data):
        if not isinstance(data, dict):
            raise RunError("服务商流式事件不是 JSON 对象。", "protocol_error")
        if "error" in data or data.get("type") == "error":
            raise RunError("服务商在流中返回错误。本次部分输出未被接受。", "provider_stream_error")
        self.emit(dict(type="activity"))
        if self.kind == "openai":
            self.metadata(data.get("model"), data.get("usage"))
            for choice in data.get("choices", []):
                if choice.get("index", 0) != 0:
                    continue
                delta = choice.get("delta", {})
                if delta.get("tool_calls") or delta.get("function_call") or delta.get("refusal"):
                    raise RunError("模型请求工具或拒绝生成，未接受几何。", "completion_rejected")
                self.append("reasoning", delta.get("reasoning_content") or delta.get("reasoning"))
                self.append("output", delta.get("content"))
                if choice.get("finish_reason"):
                    self.finish_reason = choice["finish_reason"]
                    self.terminal = True
        elif self.kind == "anthropic":
            type_ = data.get("type")
            if type_ == "message_start":
                msg = data.get("message", {})
                self.metadata(msg.get("model"), msg.get("usage"))
            elif type_ == "content_block_start":
                block = data.get("content_block", {})
                if block.get("type") == "text":
                    self.append("output", block.get("text"))
                elif block.get("type") == "thinking":
                    self.append("reasoning", block.get("thinking"))
                elif block.get("type") != "redacted_thinking":
                    raise RunError("不支持模型返回的内容类型。", "protocol_error")
            elif type_ == "content_block_delta":
                delta = data.get("delta", {})
                if delta.get("type") == "text_delta":
                    self.append("output", delta.get("text"))
                elif delta.get("type") == "thinking_delta":
                    self.append("reasoning", delta.get("thinking"))
                # signature_delta and redacted content are not reasoning text.
            elif type_ == "message_delta":
                self.finish_reason = data.get("delta", {}).get("stop_reason")
                self.metadata(usage=data.get("usage"))
            elif type_ == "message_stop":
                self.terminal = True
        else:
            self.metadata(data.get("modelVersion"), data.get("usageMetadata"))
            if data.get("promptFeedback", {}).get("blockReason"):
                raise RunError("服务商阻止了该请求。", "completion_rejected")
            for candidate in data.get("candidates", []):
                if candidate.get("index", 0) != 0:
                    continue
                for part in candidate.get("content", {}).get("parts", []):
                    if "functionCall" in part:
                        raise RunError("模型请求工具，未接受几何。", "completion_rejected")
                    self.append("reasoning" if part.get("thought") else "output", part.get("text"))
                if candidate.get("finishReason"):
                    self.finish_reason = candidate["finishReason"]
                    self.terminal = True

    def complete(self):
        expected = {"openai": "stop", "anthropic": "end_turn", "gemini": "STOP"}[self.kind]
        if not self.terminal or self.finish_reason != expected:
            raise RunError("模型输出未完整结束（可能被截断、拒绝或连接中断），部分 JSON 不会用于几何。", "incomplete_response")
        return "".join(self.parts)


def read_sse(response, assembler, control):
    fields, size, wire = [], 0, 0
    while True:
        control.check()
        line = response.readline(MAX_FRAME_BYTES + 1)
        if not line:
            if fields:
                raise RunError("服务商 SSE 帧不完整。", "incomplete_response")
            break
        control.touch()
        wire += len(line)
        size += len(line)
        if wire > MAX_WIRE_BYTES or size > MAX_FRAME_BYTES:
            raise RunError("服务商流式数据超过大小上限。", "response_limit")
        try:
            line = line.decode('utf-8').rstrip('\r\n')
        except UnicodeDecodeError:
            raise RunError("服务商返回了无效 UTF-8。", "protocol_error") from None
        if not line:
            if fields:
                value = '\n'.join(fields)
                if value == '[DONE]':
                    break
                assembler.feed(json.loads(value))
            else:
                assembler.emit(dict(type="activity"))
            fields, size = [], 0
        elif line.startswith('data:'):
            fields.append(line[5:].removeprefix(' '))
        # SSE comments are transport liveness, not generated reasoning.
        elif line.startswith(':'):
            assembler.emit(dict(type="activity"))
    return assembler.complete()


def extract_stream(text, config, emit=None, control=None, *, system=None, parser=None, max_input=30000):
    if not isinstance(text, str) or not text.strip() or len(text) > max_input:
        raise RunError("Input must contain 1–30,000 characters.", "configuration")
    if not isinstance(config, dict):
        raise RunError("Provider configuration must be an object.", "configuration")
    total_s, idle_s = timeouts(config)
    control = control or RunControl(total_s, idle_s)
    total_s, idle_s = control.total_s, control.idle_s
    control.start()
    def send(event):
        control.check()
        if emit:
            emit({**event, 'elapsed_s': round(control.elapsed, 2)})
    try:
        kind, url, headers, body = request_spec(config, text)
        if system is not None:
            if kind == 'openai':
                body['messages'][0]['content'] = system
            elif kind == 'anthropic':
                body['system'] = system
            else:
                body['systemInstruction'] = {'parts': [{'text': system}]}
        if kind == 'gemini':
            url = url.removesuffix(':generateContent') + ':streamGenerateContent?alt=sse'
        else:
            body['stream'] = True
        headers['Accept'] = 'text/event-stream, application/json'
        req = urllib.request.Request(url, data=json.dumps(body).encode(), headers=headers, method='POST')
        opener = urllib.request.build_opener(NoRedirect(), HTTPHandler(control), HTTPSHandler(control))
        for attempt in range(2):
            assembler = Assembler(kind, send)
            try:
                send(dict(type='status', stage='connecting', message='连接模型服务商，等待响应头。'))
                with opener.open(req, timeout=min(20, idle_s, max(0.01, total_s-control.elapsed))) as response:
                    control.touch()
                    send(dict(type='status', stage='waiting_provider', message='已收到服务商响应，等待模型数据。'))
                    if 'text/event-stream' in response.headers.get('Content-Type', '').lower():
                        content = read_sse(response, assembler, control)
                    else:
                        send(dict(type='status', stage='buffered_response', message='此接口返回整段响应，暂无法逐字显示；仍在等待服务商数据。'))
                        raw = response.read(MAX_RESPONSE_BYTES + 1)
                        control.touch()
                        if len(raw) > MAX_RESPONSE_BYTES:
                            raise RunError('Provider response exceeded size limit.', 'response_limit')
                        data = json.loads(raw)
                        content, usage = response_text(kind, data)
                        assembler.metadata(data.get('model') or data.get('modelVersion'), usage)
                        send(dict(type='output', text=content))
                control.check()
                send(dict(type='status', stage='parsing', message='模型输出已结束，正在解析几何 JSON。'))
                model = (parser or parse_response)(content, text)
                return model, dict(provider=kind, model=config['model'], response_model=assembler.model,
                    thinking=config.get('thinking', 'provider_default'), prompt_version=PROMPT_VERSION,
                    source_sha256=hashlib.sha256(text.encode()).hexdigest(), duration_s=round(control.elapsed, 2),
                    usage=assembler.usage, transport='stream-requested', total_timeout_s=total_s,
                    idle_timeout_s=idle_s, output_bytes=assembler.output_bytes or len(content.encode()),
                    reasoning_bytes=assembler.reasoning_bytes)
            except urllib.error.HTTPError as exc:
                status = exc.code
                exc.close()
                control.check()
                if status in (429, 502, 503, 504) and attempt == 0:
                    send(dict(type='status', stage='retrying', message=f'服务商 HTTP {status}，1 秒后重试一次。'))
                    until = time.monotonic()+1
                    while time.monotonic() < until:
                        control.check()
                        time.sleep(0.05)
                    continue
                raise RunError(f'Provider HTTP {status}. Check endpoint, credentials, quota and model access.', 'provider_http') from None
            except (TimeoutError, urllib.error.URLError) as exc:
                control.check()
                reason = getattr(exc, 'reason', exc)
                if isinstance(reason, TimeoutError):
                    code = 'idle_timeout' if control.connected else 'connect_timeout'
                    message = (f'服务商连续 {idle_s:g} 秒未返回新数据，连接已结束；已收到的部分输出未被接受。'
                               if control.connected else '连接模型服务商超时（最多 20 秒），请检查网络和接口地址。')
                    raise RunError(message, code) from None
                raise RunError('无法连接服务商，请检查网络、TLS 证书和接口地址。', 'network_error') from None
            except (OSError, ValueError, KeyError, IndexError, TypeError) as exc:
                control.check()
                if isinstance(exc, ProviderError):
                    raise
                raise RunError('模型连接中断或返回了不支持的流式格式；部分输出未被接受。', 'protocol_error') from None
    finally:
        control.finish()
