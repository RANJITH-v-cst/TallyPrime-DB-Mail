const http = require('http');

const xml = `<ENVELOPE>
 <HEADER>
  <VERSION>1</VERSION>
  <TALLYREQUEST>Export</TALLYREQUEST>
  <TYPE>Data</TYPE>
  <ID>Day Book</ID>
 </HEADER>
 <BODY>
  <DESC>
   <STATICVARIABLES>
    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
    <SVCURRENTCOMPANY>Surya Elct</SVCURRENTCOMPANY>
    <SVFROMDATE TYPE="Date">20261112</SVFROMDATE>
    <SVTODATE TYPE="Date">20261112</SVTODATE>
    <EXPLODEFLAG>Yes</EXPLODEFLAG>
   </STATICVARIABLES>
  </DESC>
 </BODY>
</ENVELOPE>`;

console.log('Sending request to Tally...');
const req = http.request({
  host: '127.0.0.1',
  port: 9000,
  method: 'POST',
  headers: { 'Content-Type': 'text/xml;charset=utf-8' },
  timeout: 10000
}, (res) => {
  console.log('Status code:', res.statusCode);
  let data = '';
  res.on('data', d => data += d);
  res.on('end', () => console.log('Response length:', data.length, 'sample:', data.slice(0, 300)));
});
req.on('timeout', () => {
  console.log('REQUEST TIMED OUT after 10s!');
  req.destroy();
});
req.on('error', e => console.error('Error:', e.message));
req.write(xml);
req.end();
