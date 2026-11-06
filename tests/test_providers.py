import json
import pytest
from detweave.providers import request_spec,response_text,parse_response,ProviderError
from detweave.server import run_extraction,examples

@pytest.mark.parametrize('kind,end,key',[('openai','/chat/completions','Authorization'),('anthropic','/messages','x-api-key'),('gemini',':generateContent','x-goog-api-key')])
def test_protocol_adapters(kind,end,key):
    protocol,url,headers,body=request_spec(dict(kind=kind,model='test-model',api_key='SECRET'), 'Source text')
    assert url.endswith(end)
    assert key in headers and 'SECRET' not in json.dumps(body) and 'SECRET' not in url
    assert 'Source text' in json.dumps(body)

@pytest.mark.parametrize('url',['http://example.com/v1','https://u:p@example.com','https://example.com?key=x','file:///tmp/a'])
def test_endpoint_validation(url):
    with pytest.raises(ProviderError):request_spec(dict(kind='openai',model='x',base_url=url,api_key='x'),'text')

def test_local_model_no_key():
    _,url,headers,_=request_spec(dict(kind='openai',model='local',base_url='http://localhost:11434/v1'),'text')
    assert 'Authorization' not in headers


def test_model_cannot_self_confirm_or_replace_original_text():
    obj={'source_text':'forged','evidence':{'x':{'status':'confirmed'}}}
    result=parse_response('```json\n'+json.dumps(obj)+'\n```','original')
    assert result['source_text']=='original' and result['evidence']['x']['status']=='stated'


def test_truncated_output_rejected():
    with pytest.raises(ProviderError):response_text('openai',{'choices':[{'finish_reason':'length'}]})
    with pytest.raises(ProviderError):parse_response('Some JSON: {}','text')


def test_demo_is_honest_and_matches_exact_source():
    with pytest.raises(ValueError):run_extraction('make a detector',{'kind':'demo'})
    result=run_extraction(examples()[0]['text'],{'kind':'demo'})
    assert result['report']['ready'] and result['provenance']['provider']=='demo'


def test_thinking_is_explicit_opt_in():
    config=dict(kind='openai',model='ark-code-latest',api_key='test',base_url='https://ark.cn-beijing.volces.com/api/coding/v3')
    assert 'thinking' not in request_spec(config,'text')[3]
    assert request_spec({**config,'thinking':'disabled'},'text')[3]['thinking']=={'type':'disabled'}
    with pytest.raises(ProviderError):request_spec({**config,'thinking':'invalid'},'text')
