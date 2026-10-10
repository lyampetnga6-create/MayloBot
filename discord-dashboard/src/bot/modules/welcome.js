'use strict';
const { buildMessage, memberVars, userVars } = require('../../lib/template');
const { getSendable, safeSend, deleteLater } = require('../util');

async function onMemberAdd(client, member) {
  const { guild } = member;
  const settings = client.ctx.settings.get(guild.id);
  const { welcome, autorole } = settings;

  /* --- Rôles automatiques --- */
  if (autorole.enabled) {
    const ids = member.user.bot ? autorole.botRoles : autorole.roles;
    const apply = async () => {
      const fresh = guild.members.cache.get(member.id) || await guild.members.fetch(member.id).catch(() => null);
      if (!fresh) return;
      const assignable = ids.filter((id) => guild.roles.cache.get(id)?.editable && !fresh.roles.cache.has(id));
      if (assignable.length) await fresh.roles.add(assignable, 'Rôle automatique').catch((e) => console.warn(`[autorole] ${guild.id}: ${e.message}`));
    };
    if (autorole.delay > 0) setTimeout(apply, autorole.delay * 1000).unref?.();
    else await apply();
  }

  /* --- Bienvenue --- */
  if (!welcome.enabled || member.user.bot) return;
  const vars = memberVars(member);

  if (welcome.channelId) {
    const payload = buildMessage(welcome.message, vars, settings.general);
    if (payload) {
      const sent = await safeSend(getSendable(guild, welcome.channelId), payload);
      deleteLater(sent, welcome.deleteAfter);
    }
  }

  if (welcome.dmEnabled) {
    const dm = buildMessage(welcome.dm, vars, settings.general);
    if (dm) await member.send(dm).catch(() => {});
  }
}

async function onMemberRemove(client, member) {
  const { guild } = member;
  const settings = client.ctx.settings.get(guild.id);
  const { welcome } = settings;
  if (!welcome.enabled || !welcome.leaveEnabled || !welcome.leaveChannelId) return;
  if (member.user.bot) return;

  const payload = buildMessage(welcome.leave, userVars(member.user, guild), settings.general);
  if (payload) await safeSend(getSendable(guild, welcome.leaveChannelId), payload);
}

module.exports = { onMemberAdd, onMemberRemove };
