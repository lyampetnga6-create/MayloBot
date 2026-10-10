'use strict';
const { formatDuration } = require('../../lib/duration');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isHttp = (u) => /^https?:\/\//i.test(u || '');

/** Récupère les messages d'un salon (du plus ancien au plus récent) sous une forme simple. */
async function collectMessages(channel, limit = 2000) {
  const all = [];
  let before;
  while (all.length < limit) {
    const batch = await channel.messages.fetch({ limit: 100, before }).catch(() => null);
    if (!batch || !batch.size) break;
    all.push(...batch.values());
    before = batch.last().id;
    if (batch.size < 100) break;
  }
  all.reverse();
  return all.filter((m) => !m.system).map((m) => ({
    id: m.id,
    at: m.createdAt,
    author: { id: m.author.id, name: m.member?.displayName || m.author.username, bot: m.author.bot, avatar: m.author.displayAvatarURL?.({ extension: 'png', size: 64 }) || '' },
    content: m.content || '',
    attachments: [...(m.attachments?.values?.() || [])].map((a) => ({ name: a.name, url: a.url })),
    embeds: (m.embeds || []).map((e) => ({ title: e.title || '', description: e.description || '', fields: (e.fields || []).map((f) => ({ name: f.name, value: f.value })) })),
  }));
}

const stamp = (d) => d.toISOString().replace('T', ' ').slice(0, 19);

function toText(messages) {
  return messages.map((m) => {
    const parts = [m.content];
    for (const a of m.attachments) parts.push(`[fichier : ${a.url}]`);
    for (const e of m.embeds) parts.push(`[embed : ${[e.title, e.description].filter(Boolean).join(' — ')}]`);
    return `[${stamp(m.at)}] ${m.author.name}${m.author.bot ? ' (bot)' : ''} : ${parts.filter(Boolean).join(' ')}`;
  }).join('\n');
}

/** Page HTML autonome (aucun script, tout est échappé). */
function toHtml(messages, meta) {
  const rows = messages.map((m) => {
    const body = [];
    if (m.content) body.push(`<div class="txt">${esc(m.content).replace(/\n/g, '<br>')}</div>`);
    for (const e of m.embeds) {
      body.push(`<div class="embed">${e.title ? `<b>${esc(e.title)}</b><br>` : ''}${esc(e.description).replace(/\n/g, '<br>')}${e.fields.map((f) => `<div><i>${esc(f.name)}</i> : ${esc(f.value)}</div>`).join('')}</div>`);
    }
    for (const a of m.attachments) {
      body.push(`<div class="att">📎 ${isHttp(a.url) ? `<a href="${esc(a.url)}" rel="noopener noreferrer">${esc(a.name)}</a>` : esc(a.name)}</div>`);
    }
    return `<div class="msg"><div class="who"><b>${esc(m.author.name)}</b>${m.author.bot ? '<span class="bot">BOT</span>' : ''}<time>${esc(stamp(m.at))}</time></div>${body.join('') || '<div class="txt muted">(message vide)</div>'}</div>`;
  }).join('\n');

  const info = [
    meta.opener && `Ouvert par : ${esc(meta.opener)}`,
    meta.topic && `Sujet : ${esc(meta.topic)}`,
    meta.closedBy && `Fermé par : ${esc(meta.closedBy)}`,
    meta.durationMs && `Durée : ${esc(formatDuration(meta.durationMs))}`,
    `${messages.length} message(s)`,
  ].filter(Boolean).join(' · ');

  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Transcript — ticket #${esc(meta.number)}</title>
<style>
body{margin:0;background:#0b0816;color:#e9e4f7;font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
header{padding:28px 32px;background:linear-gradient(135deg,#2a1458,#0b0816);border-bottom:1px solid #2b2150}
h1{margin:0 0 6px;font-size:22px}header p{margin:0;color:#b9aedb;font-size:14px}
main{max-width:860px;margin:0 auto;padding:24px 20px 60px}
.msg{padding:10px 14px;margin:0 0 8px;border-radius:10px;background:#15102b;border:1px solid #241b45}
.who{display:flex;gap:10px;align-items:baseline;margin-bottom:2px}.who b{color:#c4b5fd}
.who time{color:#7d70a8;font-size:12px}.bot{background:#6d28d9;color:#fff;font-size:10px;padding:1px 6px;border-radius:4px}
.txt{white-space:normal;overflow-wrap:anywhere}.muted{color:#7d70a8}
.embed{margin-top:6px;padding:8px 12px;border-left:4px solid #8b5cf6;background:#100b22;border-radius:4px;overflow-wrap:anywhere}
.att a{color:#a78bfa}
</style></head><body>
<header><h1>Transcript — ticket #${esc(meta.number)}</h1><p>${info}</p></header>
<main>${rows || '<p class="muted">Ticket vide.</p>'}</main>
</body></html>`;
}

module.exports = { collectMessages, toText, toHtml, esc };
