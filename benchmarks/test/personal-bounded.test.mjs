import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { capInstructions, withCappedInstructions } from '../personal-bounded.mjs';
import { makeCorpus } from '../personal-fixtures.mjs';
import { schedule } from '../personal.mjs';

test('physical instruction cap keeps a complete prefix without relevance selection',()=>{
  for(const count of [100,5000])for(const placement of ['beginning','middle','end']) {
    const corpus=makeCorpus(count,placement);
    const prefix='Common repository instructions.\n# Personal rules\n\n';
    const original=prefix+corpus.map(c=>c.raw).join('\n');
    const result=capInstructions(original);
    assert.ok(result.actual_bytes<=32768);
    assert.equal(result.instructions,prefix+corpus.slice(0,result.retained_concepts).map(c=>c.raw).join('\n'));
    assert.equal(result.total_concepts,count);
    assert.equal(result.retained_titles.length,result.retained_concepts);
    if(count===100)assert.equal(result.instructions,original);
    else {
      const next=corpus[result.retained_concepts].raw;
      assert.ok(Buffer.byteLength(result.instructions+'\n'+next)>32768);
      assert.equal(result.instructions.includes('Never add cached input a second time'),placement==='beginning');
    }
  }
});

test('invalid headers and oversized common instructions cannot silently truncate',()=>{
  assert.throws(()=>capInstructions('Missing header'),/header missing/);
  assert.throws(()=>capInstructions('x'.repeat(32768)+'\n# Personal rules\n\n'),/Common instructions exceed/);
});

test('bounded phase keeps both methods and all tasks, sizes and placements',()=>{
  const cells=schedule({selectedMethods:['flat','global']});
  assert.equal(cells.length,48);
  assert.equal(cells.filter(c=>c.method==='flat').length,24);
  assert.deepEqual([...new Set(cells.map(c=>c.placement))],['beginning','middle','end']);
});

test('runtime failure cannot hide a read-only instruction mutation during restoration',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'okf-cap-test-'));
  try {
    const file=path.join(root,'AGENTS.md'),original='Common instructions.\n# Personal rules\n\n'+makeCorpus(5000,'end').map(c=>c.raw).join('\n');
    await fs.writeFile(file,original);
    const evidence=new Map();
    const options={persist:async(label,result)=>evidence.set(label,result)};
    const runtime=async()=>{await fs.writeFile(file,'changed');throw new Error('Runtime persistence failed');};
    await assert.rejects(withCappedInstructions({codexRoot:root},options,runtime),error=>{
      assert.ok(error instanceof AggregateError);
      assert.match(error.message,/Runtime persistence failed/);
      assert.match(error.message,/changed read-only/);
      return true;
    });
    assert.equal(evidence.get('bounded-instructions-modified').stdout,'changed');
    assert.equal(await fs.readFile(file,'utf8'),original);
  } finally {await fs.rm(root,{recursive:true,force:true});}
});
