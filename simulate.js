// Usage: node simulate.js            (interactive)
//        node simulate.js script.txt (one buyer message per line, writes test-transcript.md)
const fs = require('fs'); process.env.STATE_FILE = __dirname + '/sim-state.json';
try { fs.unlinkSync(process.env.STATE_FILE); } catch {}
const { handle } = require('./bot'); const FROM = '27679809892'; const log = ['# LeadFlow simulator transcript', `_${new Date().toString()}_`, ''];
async function turn(t) { log.push(`**Buyer:** ${t}`); console.log('Buyer:', t);
  const r = await handle(FROM, t); for (const x of r.replies) { console.log('Assistant:', x); log.push(`**Assistant:** ${x.replace(/\n/g, '  \n')}`); }
  if (r.agentSummary) { console.log('\n--- AGENT SUMMARY ---\n' + r.agentSummary); log.push('', '## Agent lead summary', '```', r.agentSummary, '```'); } log.push(''); }
(async () => {
  if (process.argv[2]) { for (const l of fs.readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean)) await turn(l);
    fs.writeFileSync(__dirname + '/test-transcript.md', log.join('\n')); return; }
  const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
  rl.setPrompt('You: '); rl.prompt(); rl.on('line', async l => { await turn(l); rl.prompt(); });
})();
