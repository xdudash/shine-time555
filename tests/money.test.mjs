import test from 'node:test';import assert from 'node:assert/strict';
import {toMinorUnits} from '../assets/money.mjs';
test('money input is exact with dot or comma',()=>{assert.equal(toMinorUnits('0.29'),29);assert.equal(toMinorUnits('123,45'),12345);assert.throws(()=>toMinorUnits('1.234'));assert.throws(()=>toMinorUnits('-4'));assert.throws(()=>toMinorUnits('NaN'));});
