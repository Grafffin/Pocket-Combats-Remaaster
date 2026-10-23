// Боевой движок (GDD §6). Без DOM: тот же код потом можно перенести на сервер.
// Тактик больше нет: умения стоят ресурс (ярость, энергия, мана) и уходят на перезарядку.
// Лог пишется текстом с разметкой в духе оригинала (<ch>, <dmg>, <hp>, <skill>), UI сам решает, как её рисовать.
(function (root) {
  'use strict';
  const PC = root.PC || (root.PC = {});

  function makeRng(seed) {
    let s = (seed >>> 0) || 1;
    const next = () => {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return {
      next,
      chance: (pct) => next() * 100 < pct,
      int: (min, max) => min + Math.floor(next() * (max - min + 1)),
      float: (min, max) => min + next() * (max - min),
      pick: (arr) => arr[Math.floor(next() * arr.length)],
    };
  }

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  const VERB_GROUP = {
    sword: 'melee', mace: 'melee', axe: 'melee', greatsword: 'melee', greataxe: 'melee', fist: 'melee',
    bow: 'bow', crossbow: 'bow', staff: 'staff', wand: 'staff',
  };
  const RANGED = { bow: true, crossbow: true };

  // ---------- Боец ----------
  // tpl: { name, forms, gender, level, stats (итоговые, см. stats.js), skills: [{id, lvl}], kind (тип монстра),
  //        weaponType, consumables, isPlayer, ai, art, emoji, verbs, monsterSkills }
  function createFighter(tpl, id, team, data) {
    const st = tpl.stats;
    const forms = tpl.forms || {};
    const nom = escapeHtml(tpl.name);
    const resDef = data.resources[st.resource] || null;
    const f = {
      id, team,
      name: nom,
      forms: { nom, gen: forms.gen || nom, dat: forms.dat || nom, acc: forms.acc || nom },
      gender: tpl.gender || 'm',
      isPlayer: !!tpl.isPlayer,
      level: st.level,
      kind: tpl.kind || null,
      boss: !!tpl.boss,
      diff: tpl.diff || 0,
      art: tpl.art || null, emoji: tpl.emoji || null,
      weaponType: tpl.weaponType || 'fist',
      verbs: tpl.verbs || null,
      ai: tpl.ai || 'default',
      s: st,
      maxHp: Math.max(1, Math.round(st.maxHp)), hp: 0,
      resource: st.resource || null,
      resName: resDef ? resDef.name : null,
      resMax: st.resMax || 0, res: 0,
      skills: (tpl.skills || []).filter((sk) => sk.lvl > 0),
      monsterSkills: tpl.monsterSkills || [],
      cooldowns: {},
      effects: [],
      legendary: new Set(st.legendary || []),
      consumables: (tpl.consumables || []).map((c) => ({ ...c })),
      usedConsumableTurn: 0,
      attacksMade: 0,
      secondWindUsed: false,
    };
    f.hp = f.maxHp;
    if (f.resource === 'mana') f.res = f.resMax;
    else if (resDef) f.res = Math.min(f.resMax, resDef.start + (st.startRes || 0));
    return f;
  }

  // Сумма модификаторов эффектов по ключу (баффы/дебаффы)
  const mod = (f, key) => f.effects.reduce((s, e) => s + ((e.mods && e.mods[key]) || 0), 0);

  // ---------- Бой ----------

  class Battle {
    // Один игрок (player) или несколько (players: [{ key, tpl }]); localKey — какой из них «мой» (battle.player).
    // Бой детерминирован (seed): если на всех машинах подать те же вызовы в том же порядке, получится один и тот же бой.
    constructor({ player, players, monster, seed, data, localKey }) {
      this.data = data;
      this.rng = makeRng(seed != null ? seed : Date.now());
      this.monster = createFighter(monster, 'm', 2, data);
      this.baseHp = this.monster.maxHp;
      this.players = [];
      this.fighters = [this.monster];
      this.player = null;
      this.localKey = localKey != null ? localKey : 'me';
      this.nextPid = 0;
      this.turn = 1;
      this.log = [];
      this.ended = false;
      this.totalDealt = 0;
      const list = players || [{ key: this.localKey, tpl: player }];
      for (const e of list) this.spawn(e.tpl, e.key);
      this.say('poetry', this.rng.pick(data.haiku));
      for (const f of this.fighters) {
        if (f.legendary.has('boneShield')) this.addShield(f, Math.round(f.maxHp * 0.15), 99, 'Костяной щит');
      }
      this.say('turn', String(this.turn));
    }

    spawn(tpl, key) {
      const f = createFighter({ ...tpl, isPlayer: true }, this.players.length || this.nextPid ? `p${this.nextPid}` : 'p', 1, this.data);
      this.nextPid++;
      f.key = key;
      f.tpl = tpl;
      f.dealt = 0;      // урон монстру
      f.support = 0;    // лечение и щиты, которые игрок наложил на себя действием
      f.joinedTurn = this.players.length ? this.turn : 0;   // вступивший посреди боя действует со следующего хода
      this.players.push(f);
      this.fighters.splice(this.players.length - 1, 0, f);   // игроки идут перед монстром
      if (key === this.localKey) this.player = f;
      return f;
    }

    playerByKey(key) { return this.players.find((f) => f.key === key) || null; }
    alivePlayers() { return this.players.filter((f) => f.hp > 0 && !f.left); }

    // Вклад в бой: урон монстру плюс половина лечения и щитов
    impactOf(f) { return f.dealt + 0.5 * (f.support || 0); }

    // Награда победителю f: общий «котёл» растёт на 60% за каждого участника (как здоровье монстра),
    // и делится между выжившими пропорционально вкладу. Один игрок получает ровно 1 (обычную награду).
    rewardMult(f) {
      const pool = 1 + 0.6 * (this.players.length - 1);
      const winners = this.players.filter((p) => p.hp > 0 && !p.left);
      const total = winners.reduce((s, p) => s + this.impactOf(p), 0);
      const share = total > 0 ? this.impactOf(f) / total : 1 / Math.max(1, winners.length);
      return { mult: pool * share, share, pool };
    }

    // Победитель с точки зрения «моего» бойца: я, если монстр пал, а я жив; иначе монстр
    get winner() {
      if (!this.ended) return null;
      return this.monster.dead && this.player && this.player.hp > 0 && !this.player.left ? this.player : this.monster;
    }

    opponentOf(f) {
      if (f.team === 1) return this.monster;
      return this.target && this.target.hp > 0 && !this.target.left ? this.target : (this.alivePlayers()[0] || this.players[0]);
    }
    roll(p) { return this.rng.next() < p; }

    // Каждая запись хранит снимок состояния, чтобы UI мог проигрывать бой по строчкам
    say(type, text, ev) {
      const snap = {};
      for (const f of this.fighters || []) {
        snap[f.id] = {
          hp: f.hp, res: f.res,
          shield: this.shieldOf(f),
          effects: f.effects.map((e) => ({ id: e.id, name: e.name, kind: e.kind, turns: e.turns, disable: e.disable })),
        };
      }
      this.log.push({ id: this.log.length + 1, turn: this.turn, type, text, ev: ev || null, snap });
    }

    // ---- Текстовые шаблоны ----
    // {A} {A.gen} {B.dat} — имена в падежах, {a:ударил|ударила} — по роду A, {b:...|...} — по роду B,
    // {dmg} {hp} {skill} {heal} {verb} {adv} {ger} {Ger} — подставляются из ctx.
    fill(tpl, A, B, ctx = {}) {
      const ch = (f, form) => (f ? `<ch t="${f.team}">${f.forms[form || 'nom']}</ch>` : '');
      let s = tpl;
      s = s.replace(/\{(Ger|ger|adv)\}/g, (_, k) => {
        const v = this.rng.pick(this.data.phrases[k === 'adv' ? 'adverbs' : 'gerunds']);
        return k === 'Ger' ? v[0].toUpperCase() + v.slice(1) : v;
      });
      s = s.replace(/\{verb\}/g, () => {
        const v = ctx.verb || this.pickVerb(A);
        const word = A.gender === 'f' ? v.f : v.m;
        return `${word} ${v.p ? v.p + ' ' : ''}{B.${v.c}}`;
      });
      s = s.replace(/\{([AB])(?:\.(nom|gen|dat|acc))?\}/g, (_, who, form) => ch(who === 'A' ? A : B, form));
      s = s.replace(/\{([ab]):([^|}]*)\|([^}]*)\}/g, (_, who, m, f) => ((who === 'a' ? A : B).gender === 'f' ? f : m));
      s = s.replace(/\{(dmg|hp|skill|heal)\}/g, (_, k) => ctx[k] || '');
      return s.replace(/\s+([.,!?])/g, '$1').replace(/\s{2,}/g, ' ').trim();
    }

    pickVerb(f) {
      if (f.verbs) return this.rng.pick(f.verbs);
      const g = VERB_GROUP[f.weaponType] || 'melee';
      return this.rng.pick(this.data.phrases.verbs[g]);
    }

    phrase(key, A, B, ctx) { return this.fill(this.rng.pick(this.data.phrases[key]), A, B, ctx); }
    hpTag(f) { return `<hp>[${PC.fmtBig(f.hp)}/${PC.fmtBig(f.maxHp)}]</hp>`; }
    dmgTag(n, kind) { return `<dmg k="${kind}">-${PC.fmtBig(n)}</dmg>`; }

    // ---- Умения и ресурс ----

    skillDef(id) { return this.data.skills[id] || this.data.monsterSkills[id]; }

    skillCost(f, id) {
      const def = this.skillDef(id);
      const cost = (def && def.cost) || 0;
      return f.legendary.has('manaFont') ? Math.round(cost * 0.7) : cost;
    }

    skillState(f, id) {
      const def = this.skillDef(id);
      const cd = f.cooldowns[id] || 0;
      const cost = this.skillCost(f, id);
      const affordable = f.res >= cost;
      return { def, cd, cost, affordable, usable: cd === 0 && affordable };
    }

    usableSkills(f) {
      return f.skills.filter((sk) => this.skillState(f, sk.id).usable).map((sk) => sk.id);
    }

    gainResource(f, n, silent) {
      if (!f.resource || n <= 0) return;
      f.res = Math.min(f.resMax, f.res + n);
      void silent;
    }

    setCooldown(f, id) {
      const def = this.skillDef(id);
      if (!def || !def.cd) return;
      if (f.legendary.has('echo') && this.rng.chance(20)) {
        this.say('effect', this.fill('Эхо: {skill} готов снова.', f, f, { skill: `<skill>${def.name}</skill>` }));
        return;
      }
      const cut = Math.floor((f.s.cdr || 0) / 25);
      f.cooldowns[id] = Math.max(1, def.cd - cut) + 1; // +1: текущий ход тоже считается
    }

    // ---- Эффекты ----

    buff(f, eff) { this.addEffect(f, { kind: 'buff', ...eff }, f); }
    debuff(f, source, eff) { this.addEffect(f, { kind: 'debuff', ...eff }, source); }

    addEffect(f, eff, source) {
      const existing = f.effects.find((e) => e.id === eff.id);
      if (existing) Object.assign(existing, eff, { turns: Math.max(existing.turns, eff.turns) });
      else f.effects.push({ ...eff, source: source && source.id });
      if (eff.say !== false) {
        const text = eff.kind === 'buff'
          ? `{A} получает эффект «${eff.name}».`
          : `{B} под действием эффекта «${eff.name}».`;
        this.say('effect', this.fill(text, source || f, f));
      }
    }

    applyStun(t, source, kind = 'stun') {
      if (t.hp <= 0) return;
      if (t.legendary.has('stoneHeart')) { this.say('effect', this.fill('Каменное сердце {B.gen} не дрогнуло.', source, t)); return; }
      const freeze = kind === 'freeze';
      this.addEffect(t, {
        id: kind, name: freeze ? 'Заморозка' : 'Оглушение', kind: 'debuff', turns: 1, disable: true, say: false,
      }, source);
      this.say('effect', this.fill(freeze ? '{B} {b:скован|скована} льдом.' : '{B} {b:оглушён|оглушена}.', source, t));
    }

    // Терновый яд (уник «Терновый венец»): отдельный от обычного яда, поэтому складывается с ним
    applyThornPoison(t, source) {
      const per = Math.max(1, Math.round(this.matkOf(source) * 0.5 * (1 + (source.s.dotPct || 0))));
      this.addEffect(t, { id: 'thorn_poison', name: 'Терновый яд', kind: 'debuff', turns: 3, dot: { kind: 'poison', per }, say: false }, source);
    }

    applyChill(t, source) {
      if (t.hp <= 0) return;
      if (t.legendary.has('stoneHeart')) return;
      this.addEffect(t, { id: 'chill', name: 'Озноб', kind: 'debuff', turns: 2, chilled: true, mods: { speedPct: -0.3 }, say: false }, source);
      this.say('effect', this.fill('{B} {b:замедлен|замедлена} холодом.', source, t));
    }

    // ratio — доля атаки (или маг. атаки) источника за ход
    applyDot(t, source, kind, ratio, turns, magic) {
      if (t.hp <= 0) return;
      const power = magic ? this.matkOf(source) : this.atkOf(source);
      const per = Math.max(1, Math.round(power * ratio * (1 + (source.s.dotPct || 0))));
      const names = { poison: 'Яд', bleed: 'Кровотечение', burn: 'Горение' };
      this.addEffect(t, { id: kind, name: names[kind], kind: 'debuff', turns, dot: { kind, per }, say: false }, source);
      const texts = {
        poison: '{B} {b:отравлен|отравлена}.',
        bleed: 'У {B.gen} открылось кровотечение.',
        burn: '{B} {b:охвачен|охвачена} пламенем.',
      };
      this.say('effect', this.fill(texts[kind], source, t));
    }

    addShield(f, amount, turns, name = 'Щит') {
      if (this.acting === f) f.support += amount;
      this.addEffect(f, { id: 'shield', name, kind: 'buff', turns, shieldHp: amount, say: false }, f);
      this.say('effect', this.fill(`{A} {a:окружил|окружила} себя щитом <dmg k="heal">${PC.fmtBig(amount)}</dmg>.`, f, f), { type: 'shield', target: f.id, amount });
    }

    shieldOf(f) { return f.effects.reduce((s, e) => s + (e.shieldHp || 0), 0); }

    isDisabled(f) { return f.effects.some((e) => e.disable); }

    // ---- Эффективные характеристики ----

    atkOf(f) { return f.s.atk * (1 + mod(f, 'atkPct')); }
    matkOf(f) { return f.s.matk * (1 + mod(f, 'matkPct')); }
    defOf(f) { return Math.max(0, f.s.def * (1 + mod(f, 'defPct'))); }
    mdefOf(f) { return Math.max(0, f.s.mdef * (1 + mod(f, 'mdefPct'))); }
    speedOf(f) { return Math.max(1, f.s.speed * (1 + mod(f, 'speedPct'))); }

    hitChance(a, t) {
      let p = clamp(0.85 + (a.s.acc - t.s.eva) * 0.002, 0.3, 0.99);
      const dodge = t.effects.reduce((s, e) => s + (e.dodge || 0), 0);
      return p * (1 - clamp(dodge, 0, 0.9));
    }

    // Множитель урона от всех бонусов атакующего и уязвимостей цели
    damageMultiplier(a, t, opts) {
      let m = 1 + (a.s.dmgPct || 0) + mod(a, 'dmgPct') + mod(t, 'dmgTakenPct');
      if (t.kind) m += (a.s['vs' + t.kind[0].toUpperCase() + t.kind.slice(1)] || 0) / 100;
      if (a.hp / a.maxHp < 0.5) m += a.s.lowHpDmg || 0;
      const sid = opts.skillId || (this.current && this.current.actor === a ? this.current.skillId : null);
      if (sid && a.s.skillDmg && a.s.skillDmg[sid]) m += a.s.skillDmg[sid];
      if (a.legendary.has('execute') && t.hp / t.maxHp < 0.25) m += 0.6;
      if (a.legendary.has('coldHeart') && t.effects.some((e) => e.chilled)) m += 0.3;
      if (a.legendary.has('berserkBlood')) m += (1 - a.hp / a.maxHp) * 0.5;
      if (a.legendary.has('giantSlayer')) m += t.maxHp > a.maxHp ? 0.8 : -0.15;
      if (a.legendary.has('frostScythe') && t.effects.some((e) => e.chilled)) m += 0.4;
      return m;
    }

    // ---- Удары ----

    // Физическая атака. opts: mult, sure (не промахнётся), forceCrit, unblockable, extra (доп. действие), noCounter
    attack(a, t, opts = {}) {
      if (a.hp <= 0 || t.hp <= 0) return { hit: false };
      const r = this.rng;
      a.attacksMade++;
      if (!opts.sure && !r.chance(this.hitChance(a, t) * 100)) {
        this.say('dodge', this.phrase('dodge', a, t), { type: 'miss', target: t.id });
        this.maybeCounter(t, a, opts);
        return { hit: false };
      }

      const nextCrit = a.effects.find((e) => e.nextCrit);
      let crit = opts.forceCrit || !!nextCrit || r.chance(a.s.crit + mod(a, 'crit'));
      if (a.legendary.has('firstBlood') && a.attacksMade === 1) crit = true;
      if (nextCrit) nextCrit.nextCrit = false;
      const blocked = !opts.unblockable && t.s.block > 0 && !this.isDisabled(t) && r.chance(t.s.block);

      let dmg = (r.int(a.s.weaponMin, a.s.weaponMax) + this.atkOf(a)) * (opts.mult || 1) * this.damageMultiplier(a, t, opts);
      if (crit) dmg *= a.s.critDmg / 100;
      if (blocked) dmg *= 0.5;
      const K = PC.stats.defK(a.level);
      dmg *= K / (K + this.defOf(t));
      dmg += this.elementalAddOn(a, t);
      dmg *= 1 - (t.s.dmgReduce || 0) / 100;
      if (a.legendary.has('shred')) dmg += t.hp * 0.06;
      dmg = Math.max(1, Math.round(dmg));

      const kind = crit && blocked ? 'critblock' : crit ? 'crit' : blocked ? 'block' : 'normal';
      const key = { critblock: 'critBlock', crit: 'crit', block: t.s.shield ? 'blockShield' : 'block', normal: 'hit' }[kind];
      const dealt = this.damage(t, dmg);
      const text = opts.text
        ? this.fill(opts.text, a, t, { dmg: this.dmgTag(dmg, kind), hp: this.hpTag(t) })
        : this.phrase(opts.extra ? 'extra' : key, a, t, { dmg: this.dmgTag(dmg, kind), hp: this.hpTag(t) });
      this.say('damage', text, { type: 'damage', target: t.id, amount: dmg, kind });

      this.afterHit(a, t, dealt, { melee: !RANGED[a.weaponType], blocked });
      if (blocked) this.maybeCounter(t, a, opts);
      this.checkDeath(t);
      if (crit && !blocked && !opts.followUp && a.legendary.has('critShot') && t.hp > 0) {
        this.say('skill', this.fill('{A} тут же {a:пустил|пустила} вторую стрелу!', a, t));
        this.attack(a, t, { mult: 0.7, followUp: true, sure: true });
      }
      return { hit: true, dmg: dealt, crit, blocked };
    }

    // Заклинание: не промахивается и не блокируется, режется маг. защитой и сопротивлением стихии
    spell(a, t, opts = {}) {
      if (a.hp <= 0 || t.hp <= 0) return { dmg: 0 };
      const r = this.rng;
      if (a.legendary.has('frostScythe')) opts = { ...opts, element: 'cold', text: null };
      const surge = a.effects.find((e) => e.nextSpell);
      let dmg = this.matkOf(a) * (opts.mult || 1) * r.float(0.9, 1.1) * this.damageMultiplier(a, t, opts);
      if (surge) { dmg *= 1 + surge.nextSpell; a.effects = a.effects.filter((e) => e !== surge); }
      if (opts.element === 'fire') dmg *= 1 + (a.s.fireSpellPct || 0);
      const crit = r.chance(a.s.crit + mod(a, 'crit'));
      if (crit) dmg *= a.s.critDmg / 100;
      const K = PC.stats.defK(a.level);
      dmg *= K / (K + this.mdefOf(t));
      const resKey = { fire: 'fireRes', cold: 'coldRes', poison: 'poisonRes' }[opts.element];
      if (resKey) dmg *= 1 - (t.s[resKey] || 0) / 100;
      dmg *= 1 - (t.s.dmgReduce || 0) / 100;
      dmg = Math.max(1, Math.round(dmg));

      const kind = crit ? 'crit' : (opts.element || 'magic');
      const dealt = this.damage(t, dmg);
      const tpl = opts.text || this.rng.pick(this.data.phrases.spells[opts.element || 'arcane']);
      this.say('damage', this.fill(tpl, a, t, { dmg: this.dmgTag(dmg, kind), hp: this.hpTag(t) }), { type: 'damage', target: t.id, amount: dmg, kind });
      this.afterHit(a, t, dealt, { melee: false, spell: true });
      if (a.s.chillChance && t.hp > 0 && r.chance(a.s.chillChance)) this.applyChill(t, a);
      if (a.legendary.has('spellPoison') && t.hp > 0) this.applyThornPoison(t, a);
      if (a.legendary.has('frostScythe') && t.hp > 0) { this.applyChill(t, a); if (r.chance(50)) this.applyStun(t, a, 'freeze'); }
      this.checkDeath(t);
      return { dmg: dealt, crit };
    }

    elementalAddOn(a, t) {
      let extra = 0;
      for (const [k, res] of [['fireDmg', 'fireRes'], ['coldDmg', 'coldRes'], ['poisonDmg', 'poisonRes']]) {
        if (a.s[k]) extra += a.s[k] * (1 - (t.s[res] || 0) / 100);
      }
      return extra;
    }

    // Урон сначала съедает щиты. Возвращает урон, дошедший до здоровья.
    damage(f, n) {
      let left = n;
      for (const e of f.effects) {
        if (!e.shieldHp || left <= 0) continue;
        const take = Math.min(e.shieldHp, left);
        e.shieldHp -= take;
        left -= take;
      }
      f.effects = f.effects.filter((e) => !('shieldHp' in e) || e.shieldHp > 0);
      f.hp = Math.max(0, f.hp - left);
      if (f.hp <= 0 && f.legendary.has('phylactery') && !f.phylacteryUsed) {
        f.phylacteryUsed = true;
        f.hp = 1;
        this.heal(f, Math.round(f.maxHp * 0.4), 'Филактерия вспыхивает — {A} {a:вырвался|вырвалась} из лап смерти {heal} {hp}.');
      }
      if (left > 0 && f.resource === 'rage') this.gainResource(f, this.data.resources.rage.onHurt);
      if (f.hp > 0 && f.legendary.has('secondWind') && !f.secondWindUsed && f.hp / f.maxHp < 0.2) {
        f.secondWindUsed = true;
        this.heal(f, Math.round(f.maxHp * 0.3), '{A} {a:открыл|открыла} второе дыхание {heal} {hp}.');
      }
      return left;
    }

    selfDamage(f, n) {
      f.hp = Math.max(1, f.hp - n);
      this.say('damage', this.fill('{A} платит собственной кровью {dmg} {hp}.', f, f, { dmg: this.dmgTag(n, 'bleed'), hp: this.hpTag(f) }), { type: 'damage', target: f.id, amount: n, kind: 'bleed' });
    }

    afterHit(a, t, dealt, { melee, blocked }) {
      const r = this.rng;
      if (a.resource === 'rage') this.gainResource(a, this.data.resources.rage.onHit + (a.s.rageGain || 0));
      let ls = (a.s.lifesteal || 0) + mod(a, 'lifesteal') * 100;
      if (a.legendary.has('thirst') && a.hp / a.maxHp < 0.3) ls *= 2;
      if (ls > 0 && dealt > 0 && a.hp > 0) this.heal(a, Math.max(1, Math.round(dealt * ls / 100)), null);

      if (t.hp > 0 && dealt > 0) {
        if (a.s.stunChance && r.chance(a.s.stunChance)) this.applyStun(t, a);
        if (a.s.bleedChance && r.chance(a.s.bleedChance)) this.applyDot(t, a, 'bleed', 0.12, 3);
        if (a.legendary.has('venomous')) this.applyDot(t, a, 'poison', 0.1, 3);
        if (a.legendary.has('hunterMark') && !t.effects.some((e) => e.id === 'legend_mark')) {
          this.debuff(t, a, { id: 'legend_mark', name: 'Метка добычи', turns: 99, mods: { dmgTakenPct: 0.2 } });
        }
        if (a.legendary.has('thunder') && r.chance(15)) {
          const K = PC.stats.defK(a.level);
          const n = Math.max(1, Math.round(this.atkOf(a) * 0.8 * K / (K + this.mdefOf(t))));
          const d = this.damage(t, n);
          this.say('damage', this.fill('С небес в {B.acc} бьёт молния {dmg} {hp}.', a, t, { dmg: this.dmgTag(n, 'lightning'), hp: this.hpTag(t) }), { type: 'damage', target: t.id, amount: d, kind: 'lightning' });
        }
      }
      // Защитник: шипы и зеркальный щит
      if (melee && a.hp > 0 && !blocked) {
        const thorns = Math.round((t.s.thorns || 0) + this.defOf(t) * (t.s.thornsPct || 0));
        if (thorns > 0) {
          a.hp = Math.max(0, a.hp - thorns);
          this.say('damage', this.fill('{A} {a:напоролся|напоролась} на шипы {dmg} {hp}.', a, t, { dmg: this.dmgTag(thorns, 'normal'), hp: this.hpTag(a) }), { type: 'damage', target: a.id, amount: thorns, kind: 'normal' });
          this.checkDeath(a);
        }
      }
      if (t.legendary.has('mirrorShield') && a.hp > 0 && dealt > 0 && r.chance(20)) {
        const back = Math.max(1, Math.round(dealt * 0.5));
        a.hp = Math.max(0, a.hp - back);
        this.say('damage', this.fill('Зеркальный щит {B.gen} отражает удар {dmg} {hp}.', a, t, { dmg: this.dmgTag(back, 'magic'), hp: this.hpTag(a) }), { type: 'damage', target: a.id, amount: back, kind: 'magic' });
        this.checkDeath(a);
      }
      // Возмездие: контратака на каждый полученный удар
      const ret = t.effects.find((e) => e.counter);
      if (ret && t.hp > 0 && a.hp > 0 && !this.inCounter) {
        this.inCounter = true;
        this.say('skill', this.fill('{B} {b:отвечает|отвечает} ударом на удар.', a, t));
        this.attack(t, a, { mult: ret.counter, noCounter: true });
        this.inCounter = false;
      }
    }

    maybeCounter(def, att, opts) {
      if (opts.noCounter || this.inCounter || def.hp <= 0 || att.hp <= 0) return;
      if (!def.s.counterChance || !this.rng.chance(def.s.counterChance)) return;
      this.inCounter = true;
      this.say('skill', this.fill('{A} {a:тут же контратакует|тут же контратакует}!', def, att));
      this.attack(def, att, { mult: 0.7, noCounter: true });
      this.inCounter = false;
    }

    heal(f, amount, text) {
      const n = Math.min(amount, f.maxHp - f.hp);
      if (n <= 0) return;
      f.hp += n;
      if (this.acting === f) f.support += n;   // лечение умением учитывается во вкладе в бой
      if (text) this.say('heal', this.fill(text, f, f, { heal: `<dmg k="heal">+${PC.fmtBig(n)}</dmg>`, hp: this.hpTag(f) }), { type: 'heal', target: f.id, amount: n });
      else this.say('heal', this.fill('{A} {a:восстановил|восстановила} силы {heal} {hp}.', f, f, { heal: `<dmg k="heal">+${PC.fmtBig(n)}</dmg>`, hp: this.hpTag(f) }), { type: 'heal', target: f.id, amount: n });
    }

    checkDeath(f) {
      if (f.hp > 0 || f.dead) return;
      f.dead = true;
      const killer = f.isPlayer ? this.monster : (this.acting && this.acting.isPlayer ? this.acting : this.opponentOf(f));
      this.say('death', this.phrase(f.isPlayer ? 'deathPlayer' : 'deathMonster', killer, f));
      if (!f.isPlayer || !this.alivePlayers().length) this.ended = true;
    }

    // ---- Зелья: не тратят ход; одно за ход и затем откат POTION_CD ходов ----

    potionCooldown(f) { return Math.max(0, (f.potionReadyTurn || 0) - this.turn); }
    canUseConsumable(f) { return !this.ended && f.usedConsumableTurn !== this.turn && this.potionCooldown(f) === 0; }

    useConsumable(f, itemId) {
      const item = f.consumables.find((c) => c.id === itemId);
      if (!item || item.count <= 0 || !this.canUseConsumable(f)) return false;
      const def = this.data.consumables[itemId];
      item.count--;
      f.usedConsumableTurn = this.turn;
      f.potionReadyTurn = this.turn + (this.data.POTION_CD || 0);
      if (def.healPct) this.heal(f, Math.round(f.maxHp * def.healPct), def.text);
      if (def.resPct && f.resource) {
        const n = Math.min(Math.round(f.resMax * def.resPct), f.resMax - f.res);
        f.res += n;
        this.say('heal', this.fill(def.text, f, f, { heal: `<dmg k="mana">+${n}</dmg>` }), { type: 'mana', target: f.id, amount: n });
      }
      return true;
    }

    // ---- Выбор действий ----

    // Автобой и монстры: первое готовое умение по порядку ячеек
    autoAction(f) {
      if (f.ai === 'idle') return 'idle';
      if (f.isPlayer) return this.usableSkills(f)[0] || 'basic';
      const ready = f.monsterSkills.filter((id) => !f.cooldowns[id]);
      if (ready.length && this.rng.chance(55)) return this.rng.pick(ready);
      return 'basic';
    }

    // Ход: оба выбирают действие, затем действия разыгрываются по скорости
    submit(skillId) {
      if (this.ended) return false;
      if (skillId !== 'basic' && !this.player.skills.some((s) => s.id === skillId && this.skillState(this.player, s.id).usable)) return false;
      const actions = [
        { actor: this.player, skillId },
        { actor: this.monster, skillId: this.autoAction(this.monster) },
      ];
      this.target = this.player;
      for (const a of actions) a.init = this.speedOf(a.actor) * this.rng.float(0.9, 1.1);
      actions.sort((x, y) => y.init - x.init);

      for (const a of actions) {
        if (this.ended) break;
        this.perform(a.actor, a.skillId);
        this.extraAction(a.actor);
      }
      if (!this.ended) this.endTurn();
      return true;
    }

    // ---- Общий бой (несколько игроков, один монстр) ----

    // Монстр бьёт одного из живых игроков: последний, кто его ранил, или случайный
    pickTarget() {
      const alive = this.alivePlayers();
      if (alive.length <= 1) return alive[0] || null;
      if (this.aggro && alive.includes(this.aggro) && this.rng.chance(40)) return this.aggro;
      return this.rng.pick(alive);
    }

    // Новый участник посреди боя; здоровье монстра вырастает на 60% от базового
    addPlayer(tpl, key) {
      if (this.ended || this.playerByKey(key)) return null;
      const f = this.spawn(tpl, key);
      const add = Math.round(this.baseHp * 0.6);
      this.monster.maxHp += add;
      this.monster.hp += add;
      this.say('passed', this.fill('{A} вступает в бой!', f, this.monster));
      return f;
    }

    removePlayer(key) {
      const f = this.playerByKey(key);
      if (!f || f.left) return;
      if (f.hp <= 0) { f.left = true; return; }   // погибший просто больше не участвует и не может стать хозяином боя
      f.left = true;
      f.hp = 0;
      f.dead = true;
      this.say('passed', this.fill('{A} покидает бой.', f, this.monster));
      if (!this.alivePlayers().length) this.ended = true;
    }

    // Один ход общего боя. actions: { [key]: skillId | null } (null или нет записи — игрок не успел).
    resolveTurn(actions = {}) {
      if (this.ended) return;
      const acts = this.alivePlayers().filter((f) => f.joinedTurn !== this.turn).map((f) => ({ actor: f, skillId: actions[f.key] == null ? null : actions[f.key], monster: false }));
      acts.push({ actor: this.monster, skillId: this.autoAction(this.monster), monster: true });
      for (const a of acts) a.init = this.speedOf(a.actor) * this.rng.float(0.9, 1.1);
      acts.sort((x, y) => y.init - x.init);
      for (const a of acts) {
        if (this.ended) break;
        if (a.monster) {
          this.target = this.pickTarget();
          if (!this.target) break;
          this.act(this.monster, a.skillId);
        } else if (a.skillId == null) this.skip(a.actor);
        else this.act(a.actor, a.skillId);
      }
      if (!this.ended) this.endTurn();
    }

    // Запись хода целиком: { joins: [{key, tpl}], leaves: [key], pots: {key: itemId}, actions }
    applyTurn(rec) {
      for (const j of rec.joins || []) this.addPlayer(j.tpl, j.key);
      for (const k of rec.leaves || []) this.removePlayer(k);
      for (const [k, id] of Object.entries(rec.pots || {})) {
        const f = this.playerByKey(k);
        if (f && f.hp > 0 && !this.ended && this.canUseConsumable(f)) this.useConsumable(f, id);
      }
      this.resolveTurn(rec.actions || {});
    }

    // ---- Бой в реальном времени тика ----
    // Ход = один тик. Игрок действует, когда нажмёт; монстр — в момент, зависящий от соотношения скоростей.
    // Возвращает долю тика (0…1), когда действует боец f: чем он быстрее соперника, тем раньше.
    actionMoment(f) {
      const ratio = this.speedOf(this.opponentOf(f)) / this.speedOf(f);
      return clamp(0.35 * ratio, 0.12, 0.85);
    }

    // Одно действие бойца в текущем ходу (умение или обычный удар) и, возможно, доп. удар за счёт скорости
    act(actor, skillId) {
      if (this.ended || actor.hp <= 0) return false;
      if (skillId !== 'basic' && skillId !== 'idle' && actor.isPlayer && !actor.skills.some((s) => s.id === skillId && this.skillState(actor, s.id).usable)) skillId = 'basic';
      const before = this.monster.hp;
      this.acting = actor;
      this.perform(actor, skillId);
      this.extraAction(actor);
      this.acting = null;
      if (actor.isPlayer) { const d = Math.max(0, before - this.monster.hp); actor.dealt += d; this.totalDealt += d; if (d > 0) this.aggro = actor; }
      return true;
    }

    // Игрок не успел действовать за тик
    skip(actor) {
      if (this.ended || actor.hp <= 0) return;
      this.say('passed', this.fill('{A} {a:замешкался|замешкалась} и {a:упустил|упустила} момент.', actor, this.opponentOf(actor)));
    }

    // Сильный перевес в скорости даёт шанс ударить ещё раз
    extraAction(f) {
      if (this.ended || f.hp <= 0 || f.ai === 'idle' || this.isDisabled(f)) return;
      const other = this.opponentOf(f);
      const mine = this.speedOf(f), theirs = this.speedOf(other);
      if (mine <= theirs) return;
      const chance = Math.min(f.legendary.has('haste') ? 60 : 35, ((mine - theirs) / theirs) * 50 * (f.legendary.has('haste') ? 2 : 1));
      if (this.rng.chance(chance)) this.attack(f, other, { extra: true });
    }

    perform(actor, skillId) {
      const target = this.opponentOf(actor);
      if (actor.hp <= 0) return;
      const disabler = actor.effects.find((e) => e.disable);
      if (disabler) {
        const text = disabler.id === 'freeze' ? '{A} {a:скован|скована} льдом и не может пошевелиться.' : '{A} {a:оглушён|оглушена} и пропускает ход.';
        this.say('passed', this.fill(text, actor, target));
        actor.effects = actor.effects.filter((e) => e !== disabler); // пропускает ровно одно действие
        return;
      }
      if (skillId === 'idle') { this.say('passed', this.fill(this.rng.pick(this.data.phrases.idle), actor, target)); return; }
      if (skillId === 'basic') { this.attackBasic(actor, target); return; }

      const def = this.skillDef(skillId);
      const st = this.skillState(actor, skillId);
      if (!def || !st.usable) { this.attackBasic(actor, target); return; }
      actor.res -= st.cost;
      this.setCooldown(actor, skillId);
      this.say('skill', this.fill('{A} {a:применяет|применяет} {skill}.', actor, target, { skill: `<skill>${def.name}</skill>` }));
      const lvl = actor.isPlayer ? (actor.skills.find((s) => s.id === skillId) || { lvl: 1 }).lvl : 1;
      this.current = { actor, skillId };
      def.run(this, actor, target, def.v ? def.v(lvl) : {});
      this.current = null;
    }

    attackBasic(actor, target) {
      if (actor.s.caster) this.spell(actor, target, { mult: 1, element: actor.s.element });
      else this.attack(actor, target);
    }

    endTurn() {
      for (const f of this.fighters) {
        if (this.ended) break;
        for (const e of f.effects) {
          if (e.dot && f.hp > 0 && !this.ended) {
            let n = e.dot.per;
            const resKey = { poison: 'poisonRes', burn: 'fireRes' }[e.dot.kind];
            if (resKey) n = Math.max(1, Math.round(n * (1 - (f.s[resKey] || 0) / 100)));
            const left = this.damage(f, n);
            const texts = { poison: 'Яд разъедает {A.acc} {dmg} {hp}.', bleed: '{A} истекает кровью {dmg} {hp}.', burn: '{A} горит {dmg} {hp}.' };
            this.say('damage', this.fill(texts[e.dot.kind], f, f, { dmg: this.dmgTag(n, e.dot.kind), hp: this.hpTag(f) }), { type: 'damage', target: f.id, amount: left, kind: e.dot.kind });
            this.checkDeath(f);
          }
          if (!e.disable) e.turns--;
        }
        f.effects = f.effects.filter((e) => e.disable || e.turns > 0);
        for (const k of Object.keys(f.cooldowns)) f.cooldowns[k] = Math.max(0, f.cooldowns[k] - 1);
        if (f.hp > 0) {
          const regen = Math.round((f.s.hpRegen || 0) + f.maxHp * (f.s.hpRegenPct || 0));
          if (regen > 0 && f.hp < f.maxHp) f.hp = Math.min(f.maxHp, f.hp + regen);
          if (f.resource === 'mana') this.gainResource(f, Math.round(f.s.mpRegen || 0));
          if (f.resource === 'energy') this.gainResource(f, this.data.resources.energy.perTurn + (f.s.resPerTurn || 0));
        }
      }
      if (this.ended) return;
      this.turn++;
      this.say('turn', String(this.turn));
    }

    // Обычный удар по таймеру, если игрок не успел выбрать
    timeout() { return this.submit('basic'); }
  }

  PC.Battle = Battle;
  PC.createFighter = createFighter;
  PC.makeRng = makeRng;
  PC.clamp = clamp;
  if (typeof module !== 'undefined') module.exports = PC;
})(typeof window !== 'undefined' ? window : globalThis);
