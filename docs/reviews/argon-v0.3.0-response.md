# Argon review verification and corrections / 审查核验与修正

Reviewed input: local `AntiGravity-Argon/README.md` and its supplied
`test_adversarial_argon.py`. The original reviewer files were not changed.
No installer/native compilation, new release tag or publication was performed.

审查对象为用户提供的原始文件；未修改审查文件和验收断言。本轮只修正源码并做回归验证，
没有编译原生安装包，也没有发行 v0.3.0。

## Findings / 逐项结论

| ID | Verification and disposition / 核验与处理 |
|---|---|
| 01 | Confirmed coincident sub-tolerance shapes could pass validation. Added a documented numerical support floor of `1e-6 mm` (10 × comparison tolerance), bounded direct overlap tolerance, and world-relative particle-source margin. The proposed `1e-3 mm` floor was not adopted as a physical requirement. / 极薄几何漏检成立；采用有明确数值依据的支持下限，不将 1 µm 当作物理限制。 |
| 02 | Confirmed null container crashes. Optional null containers become empty; malformed non-null types yield controlled protocol errors. Terminal completion remains mandatory. / 空字段异常成立，修复且保留完整响应检查。 |
| 03 | Confirmed missing finish reasons were accepted in buffered responses, blocked Gemini payloads raised raw errors, uppercase JSON fences failed. All corrected; malformed/refused/tool outputs fail explicitly. |
| 04 | Confirmed key matching against structural fields/enums caused false positives, short embedded keys could escape, and scratch results bypassed gates. Fixed with schema-path-aware checks and common result validation. A global free-text whitelist was deliberately rejected because it can hide real echoes. |
| 05 | Confirmed manual-preview/current-revision mismatch and blank-answer handling. Manual IR application now persists a new revision before confirmation; displayed models are cloned from revision history and checked against saved state. Clarification actions are separated, blank answers rejected, legacy review lock can clear when validation is ready. The main chat UI had already hidden the legacy editor and record button: the supplied Python test simulates an API save rather than proving an ordinary visible-button path. |
| 06 | Confirmed explicit save could skip materializing the effective extraction draft. Saving now writes it and clears the pending-run pointer. The earlier result was already present in run history, so this was not proof that the generated model itself had been lost. |
| 07 | Confirmed literal `$` path replacement and incomplete buffered metadata; corrected callback replacements, byte counts, modelVersion and timeout/thinking metadata. Added imported-file fingerprints committed with browser snapshot and stopped SSE processing at DONE. This is maintenance of withdrawn experimental source, not reinstatement of the standalone release. |
| 08 | Added all 12 backend material colors matching the frontend, hollow-tube cap highlights, topological protection and controlled graph errors, element formulas and normalized names, build-relative material location plus explicit runtime override. Double namespace alone was cosmetic because references were consistent; unsorted input failed for direct callers, while ordinary expand() output was sorted. |
| 09 | Confirmed project/journal divergence, finish-error lock cleanup and overly strict confirmation retention. Journal is now authoritative with a recoverable project draft mirror; manual API saves become revisions; unchanged user-confirmed fields preserve their original evidence. The claim that RunError does not inherit ProviderError is false: it already does. ConversationConflict required separate classification. |
| 10 | Confirmed invalid partial timeout could be saved on provider switch; now checked before queueing. Error formatting accepts actual custom storage paths. `mkstemp` already creates mode 0600, so missing explicit chmod was not evidence of a public-readable key file; an explicit POSIX fchmod was added as defense in depth. |

## Test evidence / 验证结果

- Before changes, the reviewer's default reproduction suite: **25 passed**.
  Some tests only match source strings; this is not proof of every narrative claim
  or severity rating.
- After changes, project Python suite: **128 passed**.
- Reviewer's unmodified `ARGON_VERIFY_MODE=fixed` suite: **24 passed, 1 failed**.
- Browser conversation regression: passed, including manual edit → saved revision →
  current-value confirmation, stale-confirm HTTP 409, reload and display/history isolation.
- Browser provider-settings regression: passed, including switching during invalid
  partial timeout input without a settings HTTP 400.
- JavaScript syntax and `git diff --check`: passed.

### Why the one supplied fixed-mode test is not adopted unchanged

`test_argon_05b_confirm_evidence_after_json_apply_reverts_user_edits_to_old_revision`
updates the geometry, then submits the **old** revision ID to confirm it. Its fixed
branch expects success. That allows a stale confirmation to approve values the
request did not identify, which contradicts version safety.

The corrected behavior is:

1. The manual save creates a new revision containing the edited value.
2. Confirmation with the old ID is rejected with `ConversationConflict` / HTTP 409;
   the new value is preserved.
3. Refresh/load the new revision ID, then confirm its actual displayed value.

This behavior is covered by
`tests/test_conversation.py::test_manual_edit_is_revision_and_stale_confirmation_rejected`
and `scripts/check_conversation.cjs`. The original test is retained untouched as
an explicit review-contract disagreement, rather than weakening the safeguard
or changing the reviewer's assertions to obtain a green count.

唯一未通过的原验收项要求“修改后仍用旧版本号确认成功”。本次保留拒绝过期确认的保护，
并通过独立测试验证：修改值不丢失，界面取得新版本后可以正确确认。没有为了全绿修改原测试。

## Reproduce / 复核命令

```sh
python3 -m pytest -q
ARGON_VERIFY_MODE=fixed python3 -m pytest AntiGravity-Argon/test_adversarial_argon.py -q
node scripts/check_conversation.cjs
node scripts/check_provider_settings.cjs
```

Browser scripts require Playwright/Chromium; see existing development instructions.
They use temporary project/settings directories and synthetic credentials.
The second command intentionally retains the single stale-confirm expectation failure.
Legacy `scripts/check_ui.cjs` targets the former one-shot UI; current conversation
regression replaces that interactive flow. The retired standalone file was not
rebuilt or reissued; bridge/runtime fixes were checked at source/bridge level.

No new Geant4/DD4hep native compilation or engine validation was performed. The
reviewer's baseline engine check reused an existing local binary when available;
this does not validate the newly changed C++ templates. Those changes still require
compilation and runtime testing in the next authorized release-validation stage.

## Subsequent release authorization / 后续发行授权

After the source-review correction stage, the user authorized native compilation and publication. Fresh Geant4 and live Ark results are recorded under [v0.3.0 verification](../verification/v0.3.0/); platform build/runtime results are recorded in the release BUILD-MANIFEST. The earlier no-compilation statements above describe the review-only stage.

源码核验后，用户已明确授权编译发行。后续验证记录与发行构建清单分别列出实测结果，不将审查阶段与发行阶段混淆。


### 发行前追加原生验证

严格界面检查发现并修复了 Linux Toga GTK 0.5.7 的脚本注入兼容问题：
该接口以 Python 字符数指定 UTF-8 字节长度，导致含中文提示的保存脚本截断。
现改用等价 Unicode 转义，保留中文显示；新增行为回归验证保存和目录选择回调。
iOS 检查改为等待真实 DOM 就绪，避免固定五秒截图得到尚未加载的空白页。
最终原生检查要求聊天、项目控件和配置初始化正常，保存桥接函数存在，
桌面版本另要求目录选择桥接函数存在。
