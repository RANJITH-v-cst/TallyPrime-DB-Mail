const { TallyClient } = require('../dist/tally/client');
async function test() {
  const client = new TallyClient({ host: '127.0.0.1', port: 9000 });
  const pingXml = `<ENVELOPE>
 <HEADER>
  <VERSION>1</VERSION>
  <TALLYREQUEST>Export</TALLYREQUEST>
  <TYPE>Collection</TYPE>
  <ID>ADV Company Coll</ID>
 </HEADER>
 <BODY>
  <DESC>
   <STATICVARIABLES>
    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
   </STATICVARIABLES>
   <TDL>
    <TDLMESSAGE>
     <COLLECTION NAME="ADV Company Coll" ISMODIFY="No" ISFIXED="No">
      <TYPE>Company</TYPE>
      <FETCH>Name</FETCH>
     </COLLECTION>
    </TDLMESSAGE>
   </TDL>
  </DESC>
 </BODY>
</ENVELOPE>`;
  try {
    const res = await client.sendXml(pingXml, 5000);
    console.log('Response:', res.slice(0, 300));
  } catch(e) {
    console.error('Ping error:', e.message);
  }
}
test();
