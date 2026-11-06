'use strict';
/**
 * Client IA minimal (aucune dépendance) : API « compatible OpenAI » et API Anthropic.
 * Les adresses des fournisseurs sont FIXES (liste ci-dessous) pour qu'un gestionnaire de serveur
 * ne puisse pas faire envoyer des requêtes du bot vers n'importe quelle adresse (SSRF).
 * Seul le propriétaire du bot peut définir une adresse libre, via la variable AI_BASE_URL.
 */
const PRESETS = {
  openai: { label: 'OpenAI', kind: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  anthropic: { label: 'Anthropic (Claude)', kind: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-haiku-5-5' },
  openrouter: { label: 'OpenRouter', kind: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini' },
  groq: { label: 'Groq', kind: 'openai', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
  mistral: { label: 'Mistral', kind: 'openai', baseUrl: 'https://api.mistral.ai/v1', model: 'mistral-small-latest' },
  gemini: { label: 'Google Gemini', kind: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.0-flash' },
  deepseek: { label: 'DeepSeek', kind: 'openai', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
};

const MODEL_RE = /^[\w.:/@+-]{1,100}$/;

class AiError extends Error {
  constructor(message, code = 'ai_error') {
    super(message);
    this.code = code;
  }
}

/**
 * Détermine quel fournisseur utiliser.
 * @param {object} config   configuration globale (config.ai : provider, apiKey, baseUrl, model)
 * @param {object} guildAi  réglages du module « ai » du serveur
 * @param {string|null} guildKey clé API du serveur (déjà déchiffrée) ou null
 * @returns {{kind,baseUrl,apiKey,model,source,provider}|null}
 */
function resolveProvider(config, guildAi = {}, guildKey = null) {
  const choice = guildAi.provider || 'default';
  if (choice !== 'default') {
    const preset = PRESETS[choice];
    if (!preset || !guildKey) return null;
    const model = MODEL_RE.test(guildAi.model || '') ? guildAi.model : preset.model;
    return { kind: preset.kind, baseUrl: preset.baseUrl, apiKey: guildKey, model, source: 'guild', provider: choice };
  }
  const g = config.ai || {};
  if (!g.apiKey) return null;
  const preset = PRESETS[g.provider];
  const kind = preset ? preset.kind : (g.provider === 'anthropic' ? 'anthropic' : 'openai');
  const baseUrl = g.baseUrl || preset?.baseUrl || PRESETS.openai.baseUrl;
  const model = MODEL_RE.test(guildAi.model || '') ? guildAi.model : (g.model || preset?.model || PRESETS.openai.model);
  return { kind, baseUrl: baseUrl.replace(/\/+$/, ''), apiKey: g.apiKey, model, source: 'global', provider: g.provider || 'openai' };
}

/** Alterne user / assistant (exigé par certaines API) et supprime les messages vides. */
function normalizeMessages(messages) {
  const out = [];
  for (const m of messages) {
    const content = String(m.content ?? '').trim();
    if (!content) continue;
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    const last = out[out.length - 1];
    if (last && last.role === role) last.content += `\n${content}`;
    else out.push({ role, content });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

function friendlyHttpError(status, bodyText) {
  if (status === 401 || status === 403) return new AiError('La clé API est refusée par le fournisseur d’IA. Vérifie-la dans la page « Intelligence artificielle ».', 'auth');
  if (status === 404) return new AiError('Modèle ou adresse introuvable chez le fournisseur d’IA (vérifie le nom du modèle).', 'not_found');
  if (status === 429) return new AiError('Le fournisseur d’IA limite le nombre de requêtes (ou le crédit est épuisé). Réessaie dans un instant.', 'rate_limit');
  if (status >= 500) return new AiError('Le fournisseur d’IA est indisponible pour le moment.', 'upstream');
  let detail = '';
  try { detail = JSON.parse(bodyText)?.error?.message || ''; } catch { /* corps non JSON */ }
  return new AiError(`Requête refusée par le fournisseur d’IA${detail ? ` : ${String(detail).slice(0, 200)}` : ` (HTTP ${status})`}.`, 'bad_request');
}

/**
 * Appelle le modèle. Renvoie le texte de la réponse.
 * @param {object} p { provider, system, messages, temperature, maxTokens, timeoutMs, fetchImpl }
 */
async function complete({ provider, system = '', messages, temperature = 0.7, maxTokens = 600, timeoutMs = 60000, fetchImpl = fetch }) {
  if (!provider) throw new AiError('Aucune IA n’est configurée.', 'not_configured');
  const msgs = normalizeMessages(messages);
  if (!msgs.length) throw new AiError('Rien à envoyer à l’IA.', 'empty');

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    let url;
    let headers;
    let body;
    if (provider.kind === 'anthropic') {
      url = `${provider.baseUrl}/v1/messages`;
      headers = { 'content-type': 'application/json', 'x-api-key': provider.apiKey, 'anthropic-version': '2023-06-01' };
      body = { model: provider.model, max_tokens: maxTokens, temperature: Math.min(1, temperature), messages: msgs };
      if (system) body.system = system;
    } else {
      url = `${provider.baseUrl}/chat/completions`;
      headers = { 'content-type': 'application/json', authorization: `Bearer ${provider.apiKey}` };
      body = {
        model: provider.model,
        temperature,
        max_tokens: maxTokens,
        messages: [...(system ? [{ role: 'system', content: system }] : []), ...msgs],
      };
    }

    let res;
    try {
      res = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(body), signal: ctl.signal });
    } catch (err) {
      if (err.name === 'AbortError') throw new AiError('L’IA a mis trop de temps à répondre.', 'timeout');
      throw new AiError('Impossible de joindre le fournisseur d’IA.', 'network');
    }
    const text = await res.text();
    if (!res.ok) throw friendlyHttpError(res.status, text);

    let json;
    try { json = JSON.parse(text); } catch { throw new AiError('Réponse illisible du fournisseur d’IA.', 'bad_response'); }
    const out = provider.kind === 'anthropic'
      ? (json.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('')
      : json.choices?.[0]?.message?.content;
    const answer = typeof out === 'string' ? out.trim() : '';
    if (!answer) throw new AiError('L’IA n’a renvoyé aucune réponse.', 'empty_answer');
    return answer;
  } finally {
    clearTimeout(timer);
  }
}

/** Extrait le premier objet JSON d'un texte (le modèle peut l'entourer de ```json … ```). */
function extractJson(text) {
  const s = String(text);
  const start = s.indexOf('{');
  if (start === -1) throw new AiError('L’IA n’a pas renvoyé de plan exploitable. Réessaie en reformulant.', 'bad_json');
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      try { return JSON.parse(s.slice(start, i + 1)); } catch { break; }
    }
  }
  throw new AiError('L’IA a renvoyé un plan mal formé. Réessaie.', 'bad_json');
}

const providerChoices = () => [['default', 'Celui du bot (par défaut)'], ...Object.entries(PRESETS).map(([id, p]) => [id, p.label])];

module.exports = { PRESETS, MODEL_RE, AiError, resolveProvider, complete, normalizeMessages, extractJson, providerChoices };
