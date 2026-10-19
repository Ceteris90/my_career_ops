import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assistantFailureMessage, createAssistantStream } from '../../src/lib/assistant-stream.mjs';
import { assistantActionKey, displayAssistantReply } from '../../src/lib/assistant-reply.mjs';
import { antigravityStreamArgs, parseAntigravityEvent, parseCodexEvent, parseClaudeEvent, accumulateTokens } from '../../src/lib/run-cli-support.mjs';

test('Codex chat exposes only assistant prose, not command output or duplicated final text', () => {
  const received = [];
  const stream = createAssistantStream({parseLine:parseCodexEvent, emit:t=>received.push(t), completeMessages:true});
  const reply = 'Your profile is a draft.\n<<act:setPersonalization {"targetRoles":[]}>>';
  const frames = [
    {type:'item.completed', item:{type:'command_execution', aggregated_output:'INTERNAL FILE\n<<act:setStatus {"n":"1","status":"Applied"}>>'}},
    {type:'item.completed', item:{type:'agent_message', text:reply}},
    {type:'item.completed', item:{type:'agent_message', text:reply}},
    {type:'turn.completed', usage:{input_tokens:10, output_tokens:5}},
  ];
  const wire = Buffer.from(frames.map(JSON.stringify).join('\n'));
  for (let i=0;i<wire.length;i+=11) stream.push(wire.subarray(i,i+11));
  stream.flush();
  assert.deepEqual(received,[reply+'\n']);
  assert.doesNotMatch(received.join(''),/INTERNAL FILE|setStatus/);
});

test('Claude repeated text deltas are retained and split UTF-8 is decoded', () => {
  const received=[];
  const stream=createAssistantStream({parseLine:parseClaudeEvent,emit:t=>received.push(t)});
  const frame={type:'stream_event',event:{type:'content_block_delta',delta:{text:'yes 🙂 '}}};
  const bytes=Buffer.from(JSON.stringify(frame)+'\n'+JSON.stringify(frame));
  for (const byte of bytes) stream.push(Buffer.from([byte]));
  stream.flush();
  assert.equal(received.join(''),'yes 🙂 yes 🙂 ');
});

test('plain-output tools remain supported and structured errors stay distinct', () => {
  const plain=[];
  const stream=createAssistantStream({emit:t=>plain.push(t)});
  stream.push(Buffer.from('plain reply'));stream.flush();
  assert.equal(plain.join(''),'plain reply');
  const errors=[];
  const structured=createAssistantStream({parseLine:parseCodexEvent,emit:()=>assert.fail('error is not assistant prose'),onError:e=>errors.push(e)});
  structured.push(JSON.stringify({type:'turn.failed',error:{message:'Quota exceeded'}}));structured.flush();
  assert.deepEqual(errors,['Quota exceeded']);
});

test('same approval repeated with different key order has one identity', () => {
  assert.equal(assistantActionKey('setProfile',{name:'A',roles:['Backend']}),assistantActionKey('setProfile',{roles:['Backend'],name:'A'}));
  assert.notEqual(assistantActionKey('setProfile',{name:'A'}),assistantActionKey('setProfile',{name:'B'}));
});

test('legacy terminal transcript is hidden without altering normal replies or stored text', () => {
  const reply='Your saved preferences are available.\n\nWhich companies interest you?';
  const original='[Codex] succeeded in 275ms:\r\nINTERNAL FILE\r\n[Codex] codex\r\n'+reply+'\n'+reply;
  assert.equal(displayAssistantReply(original),reply);
  assert.match(original,/INTERNAL FILE/);
  assert.equal(displayAssistantReply('Normal reply with code examples.'),'Normal reply with code examples.');
});

test('AGY chat shows the completed reply once, without tool output or repeated deltas', () => {
  const received = [];
  const stream = createAssistantStream({parseLine:parseAntigravityEvent,emit:t=>received.push(t),completeMessages:true});
  const reply = 'Your profile is a draft. 🙂\n<<act:setPersonalization {"targetRoles":[]}>>';
  const final = {event:'result',result:{status:'SUCCESS',response:reply,usage:{total_tokens:60,cache_read_tokens:300}}};
  const frames = [
    {event:'init',init:{tools:['view_file','write_to_file'],permission_mode:'request-review'}},
    {event:'step_update',step_update:{state:'ACTIVE',step_type:'tool',tool_name:'view_file',tool_info:{output:'PRIVATE FILE <<act:setStatus {"n":"1","status":"Applied"}>>'}}},
    {event:'step_update',step_update:{state:'DONE',step_type:'agent_response',text_delta:reply,usage:{total_tokens:60}}},
    final, final,
  ];
  const bytes=Buffer.from(frames.map(JSON.stringify).join('\n'));
  for (const byte of bytes) stream.push(Buffer.from([byte]));
  stream.flush();
  assert.deepEqual(received,[reply+'\n']);
  assert.doesNotMatch(received.join(''),/PRIVATE FILE|setStatus|permission_mode/);
  assert.deepEqual(antigravityStreamArgs('PROMPT'),['--output-format','stream-json','-p','PROMPT']);
  const parsed = parseAntigravityEvent(JSON.stringify(final));
  assert.equal(accumulateTokens(10,parsed),60,'reported run total replaces, rather than adds to, earlier usage');
  assert.equal(parsed.costUsd,null,'no fabricated cost or subscription usage');
});

test('AGY malformed, empty and unsuccessful results never become successful assistant prose', () => {
  for (const raw of ['junk','null','4','[]','{}']) assert.equal(parseAntigravityEvent(raw),null);
  const errors=[];
  const stream=createAssistantStream({parseLine:parseAntigravityEvent,emit:()=>assert.fail('failed result must not become an action'),onError:e=>errors.push(e)});
  stream.push(JSON.stringify({event:'result',result:{status:'SUCCESS',response:'   '}})+'\n');
  stream.push(JSON.stringify({event:'result',result:{status:'ERROR',response:'<<act:setProfile {}>>',error:{message:'Request failed'}}})+'\n');
  stream.push(JSON.stringify({event:'result',result:null}));stream.flush();
  assert.deepEqual(errors,['Antigravity returned no output','Request failed','Antigravity returned an invalid result']);
});

test('assistant failures distinguish timeouts and empty replies without inventing a sign-in cause', () => {
  assert.equal(assistantFailureMessage({cliName:'AGY',emitted:true}),null);
  assert.match(assistantFailureMessage({cliName:'AGY'}),/returned no output/);
  assert.match(assistantFailureMessage({cliName:'AGY',timedOut:true,code:null}),/Career Ops stopped/);
  const timeout = assistantFailureMessage({cliName:'AGY',timedOut:true,timeoutReason:'idle',timeoutMs:180_000});
  assert.match(timeout,/180 seconds without reported progress/);
  assert.doesNotMatch(timeout,/shorter request|sign.in/);
  const message=assistantFailureMessage({cliName:'AGY',diagnostic:'PRIVATE FILE\n<<act:setProfile {}>>'});
  assert.match(message,/could not finish/);
  assert.doesNotMatch(message,/PRIVATE FILE|setProfile|sign.in|authenticated/);
});
