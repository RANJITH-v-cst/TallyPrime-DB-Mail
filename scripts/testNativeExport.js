const http = require('http');
const fs = require('fs');

const xml = `<?xml version="1.0" encoding="utf-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Export Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <EXPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Day Book</REPORTNAME>
        <STATICVARIABLES>
          <SVEXPORTFORMAT>$$SysName:Excel</SVEXPORTFORMAT>
          <SVFILENAME>C:\\Users\\ranji\\OneDrive\\Desktop\\Advent DB Export\\TallyNativeTest.xlsx</SVFILENAME>
          <SVFROMDATE TYPE="Date">20261112</SVFROMDATE>
          <SVTODATE TYPE="Date">20261112</SVTODATE>
        </STATICVARIABLES>
      </REQUESTDESC>
    </EXPORTDATA>
  </BODY>
</ENVELOPE>`;

const req = http.request({
  hostname: '127.0.0.1',
  port: 9000,
  path: '/',
  method: 'POST',
  headers: {
    'Content-Type': 'application/xml',
    'Content-Length': Buffer.byteLength(xml)
  }
}, res => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log('Response status:', res.statusCode);
    console.log('Body:', data.substring(0, 500));
  });
});
req.on('error', console.error);
req.write(xml);
req.end();
