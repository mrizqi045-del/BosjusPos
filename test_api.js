require('dotenv').config();
const handler = require('./api/data');

async function testApi() {
  const req = {
    method: 'GET',
    query: { action: 'getData' },
    headers: {}
  };

  const res = {
    statusCode: 200,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(data) {
      console.log('Status Code:', this.statusCode);
      console.log('API Status:', data.status);
      const keys = Object.keys(data.data || {});
      console.log('Total Keys returned:', keys.length);
      console.log('Samples of Keys returned:');
      for (const k of keys) {
        const val = data.data[k];
        console.log(` - ${k} (${typeof val === 'string' ? val.length : 'obj'} chars)`);
      }
    }
  };

  await handler(req, res);
}

testApi();
