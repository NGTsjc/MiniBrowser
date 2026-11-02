import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderText,escapeHtml} from '../../.cache/unit/i18n-format.js';

test('named values are substituted once and special text remains literal',()=>{
  assert.equal(renderText('{max} / {min} / {max}',{min:1,max:'{min}<b>'}),'{min}<b> / 1 / {min}<b>');
  assert.equal(renderText('{missing}',{}),'{missing}');
});
test('translation text is escaped for both DOM content and quoted attributes',()=>{
  assert.equal(escapeHtml('<img src=x onerror="alert(1)"> & \'quoted\''),'&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;quoted&#39;');
  assert.equal(escapeHtml('中文\nLong text'), '中文\nLong text');
});
