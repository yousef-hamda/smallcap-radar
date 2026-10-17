import test from 'node:test';
import assert from 'node:assert/strict';
import {nasdaqCompanyDescription} from '../../.test-build/company-description.mjs';

test('Nasdaq company description accepts issuer prose and rejects absent or placeholder text',()=>{
 const description='Example Payments Inc. provides cross-border payment processing and local settlement services to merchants.';
 assert.equal(nasdaqCompanyDescription({data:{CompanyDescription:{value:description}}}),description);
 assert.equal(nasdaqCompanyDescription({data:{CompanyDescription:{value:'N/A'}}}),null);
 assert.equal(nasdaqCompanyDescription({data:{CompanyDescription:{value:42}}}),null);
 assert.equal(nasdaqCompanyDescription({data:null}),null);
});
