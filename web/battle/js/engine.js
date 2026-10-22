// Боевой движок прототипа. Без DOM: тот же код потом можно перенести на сервер.
// Лог пишется текстом с разметкой в духе оригинала (<ch>, <dmg>, <hp>, <skill>), UI сам решает, как её рисовать.
(function (root) {
  'use strict';
  const PC = root.PC || (root.PC = {});

  const TACTICS = ['hit', 'block', 'crit', 'dodge'];
  const TACTIC_CAP = 9;

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
      pick: (arr) => arr[Math.floor(next() * arr.length)],
    };
  }

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------- Персонажи ----------

  function createFighter(tpl, id, team) {
    const st = tpl.stats;
    const level = tpl.level;
    const maxHp = tpl.hp != null ? tpl.hp : 20 + level * 3 + st.vit * 3;
    const maxMana = tpl.mana != null ? tpl.mana : 5 + st.wis * 3;
    const forms = tpl.forms || {};
    const nom = escapeHtml(tpl.name);
    return {
      id, team,
      name: nom,
      forms: { nom, gen: forms.gen || nom, dat: forms.dat || nom, acc: forms.acc || nom },
      gender: tpl.gender || 'm',
      isPlayer: !!tpl.isPlayer,
      level, stats: { ...st },
      icon: tpl.icon || null, emoji: tpl.emoji || null,
      maxHp, hp: maxHp, maxMana, mana: maxMana,
      weapon: { ...tpl.weapon },
      shield: !!tpl.shield,
      blockBase: tpl.block,
      softDef: tpl.softDef || 0, hardDef: tpl.hardDef || 0,
      softMdef: tpl.softMdef || 0, hardMdef: tpl.hardMdef || 0,
      mdmg: tpl.mdmg || 0,
      verbs: tpl.verbs || null,
      ai: tpl.ai || 'default',
      skills: ['basic', ...(tpl.skills || [])],
      cooldowns: {},
      tactics: { hit: 0, block: 0, crit: 0, dodge: 0 },
      effects: [],
      consumables: (tpl.consumables || []).map((c) => ({ ...c })),
      exp: tpl.exp || 0,
      usedConsumableTurn: 0,
    };
  }

  function effectSum(f, key) {
    return f.effects.reduce((s, e) => s + (e[key] || 0), 0);
  }

  // Формулы в духе Ragnarok Online, на котором явно строился оригинал:
  // попадание — от интуиции (DEX) и чуть от удачи, уклонение — от ловкости и чуть от удачи, крит — от удачи.
  const formulas = {
    dodgeChance(att, def) {
      const hit = att.level + att.stats.dex + att.stats.luk / 3;
      const flee = def.level + def.stats.agi + def.stats.luk / 5;
      return clamp(10 + (flee - hit) * 1.5 + effectSum(def, 'dodgeBonus'), 3, 60);
    },
    critChance(att) {
      return clamp(3 + att.stats.luk + effectSum(att, 'critBonus'), 1, 50);
    },
    blockChance(def) {
      if (def.weapon.type === 'bow') return 0; // с луком блокировать нельзя
      const base = def.blockBase != null ? def.blockBase : (def.shield ? 20 + def.stats.vit : 6);
      return clamp(base + effectSum(def, 'blockBonus'), 0, 75);
    },
    weaponBonus(att) {
      if (att.weapon.type === 'bow') return Math.floor(att.stats.dex / 2);
      return Math.floor(att.stats.str / 2);
    },
    hardDef(def) {
      return clamp(def.hardDef + effectSum(def, 'hardDefBonus'), 0, 80);
    },
  };

  // ---------- Бой ----------

  class Battle {
    constructor({ player, monster, seed, data }) {
      this.data = data;
      this.rng = makeRng(seed != null ? seed : Date.now());
      this.player = createFighter({ ...player, isPlayer: true }, 'p', 1);
      this.monster = createFighter(monster, 'm', 2);
      this.fighters = [this.player, this.monster];
      this.turn = 1;
      this.log = [];
      this.ended = false;
      this.winner = null;
      this.say('poetry', this.rng.pick(data.haiku));
      this.say('turn', String(this.turn));
    }

    opponentOf(f) { return f === this.player ? this.monster : this.player; }

    // Каждая запись хранит снимок HP/маны/тактик/эффектов, чтобы UI мог проигрывать бой по строчкам
    say(type, text, ev) {
      const snap = {};
      for (const f of this.fighters || []) {
        snap[f.id] = { hp: f.hp, mana: f.mana, tactics: { ...f.tactics }, effects: f.effects.map((e) => ({ ...e })) };
      }
      this.log.push({ id: this.log.length + 1, turn: this.turn, type, text, ev: ev || null, snap });
    }

    // ---- Текстовые шаблоны ----
    // {A} {A.gen} {B.dat} — имена в падежах, {a:ударил|ударила} — по роду A, {b:...|...} — по роду B,
    // {dmg} {hp} {skill} {verb} {adv} {ger} {Ger} — подставляются из ctx.
    fill(tpl, A, B, ctx = {}) {
      const ch = (f, form) => f ? `<ch t="${f.team}">${f.forms[form || 'nom']}</ch>` : '';
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
      return this.rng.pick(this.data.phrases.verbs[f.weapon.type] || this.data.phrases.verbs.melee);
    }

    phrase(key, A, B, ctx) {
      return this.fill(this.rng.pick(this.data.phrases[key]), A, B, ctx);
    }

    hpTag(f) { return `<hp>[${f.hp}/${f.maxHp}]</hp>`; }
    dmgTag(n, kind) { return `<dmg k="${kind}">-${n}</dmg>`; }

    // ---- Ресурсы ----

    canAfford(f, skill) {
      const cost = skill.cost || {};
      for (const t of TACTICS) if ((cost[t] || 0) > f.tactics[t]) return false;
      if ((cost.mana || 0) > f.mana) return false;
      return true;
    }

    skillState(f, skillId) {
      const skill = this.data.skills[skillId];
      const cd = f.cooldowns[skillId] || 0;
      return { skill, cooldown: cd, affordable: this.canAfford(f, skill), usable: cd === 0 && this.canAfford(f, skill) };
    }

    usableSkillCount(f) {
      return f.skills.filter((id) => id !== 'basic' && this.skillState(f, id).usable).length;
    }

    gainTactic(f, t) { f.tactics[t] = Math.min(TACTIC_CAP, f.tactics[t] + 1); }

    pay(f, skill) {
      const cost = skill.cost || {};
      for (const t of TACTICS) f.tactics[t] -= cost[t] || 0;
      f.mana -= cost.mana || 0;
      if (skill.cooldown) f.cooldowns[skill.id] = skill.cooldown + 1; // +1: текущий ход тоже считается
    }

    // ---- Боевые действия (вызываются из skill.run) ----

    // Физический или магический удар. Возвращает исход, чтобы приём мог навесить эффект только при попадании.
    strike(att, def, opts = {}) {
      if (!def.hp) return { outcome: 'none' };
      const r = this.rng;
      const magic = !!opts.magic;

      if (!magic && !opts.undodgeable && r.chance(formulas.dodgeChance(att, def))) {
        this.gainTactic(def, 'dodge');
        this.say('dodge', this.phrase('dodge', att, def), { type: 'miss', target: def.id });
        return { outcome: 'dodge' };
      }

      const crit = !magic && (opts.forceCrit || r.chance(formulas.critChance(att)));
      const blocked = !magic && !opts.unblockable && !this.isDisabled(def) && r.chance(formulas.blockChance(def));
      const mult = (opts.mult || 1) * (1 + effectSum(att, 'dmgBonus') / 100);

      let raw, softDef, hardDef;
      if (magic) {
        raw = r.int(opts.min, opts.max) + Math.floor(att.stats.wis / 2) + att.mdmg;
        softDef = def.softMdef; hardDef = def.hardMdef;
      } else {
        const bonus = formulas.weaponBonus(att);
        raw = (crit && !blocked) ? Math.round((att.weapon.max + bonus) * 1.5) : r.int(att.weapon.min, att.weapon.max) + bonus;
        softDef = (crit && !blocked) || opts.ignoreDef ? 0 : def.softDef;
        hardDef = opts.ignoreDef ? 0 : formulas.hardDef(def);
      }
      let dmg = (raw * mult - softDef) * (1 - hardDef / 100);
      if (blocked && !crit) dmg /= 2;
      dmg = Math.max(1, Math.round(dmg));

      let kind, key;
      if (magic) { kind = 'normal'; key = null; this.gainTactic(att, 'hit'); }
      else if (crit && blocked) { kind = 'critblock'; key = 'critBlock'; this.gainTactic(att, 'hit'); this.gainTactic(def, 'block'); }
      else if (crit) { kind = 'crit'; key = 'crit'; this.gainTactic(att, 'crit'); }
      else if (blocked) { kind = 'block'; key = def.shield ? 'blockShield' : 'block'; this.gainTactic(def, 'block'); }
      else { kind = 'normal'; key = 'hit'; this.gainTactic(att, 'hit'); }

      this.damage(def, dmg);
      const ctx = { dmg: this.dmgTag(dmg, kind), hp: this.hpTag(def), verb: opts.verb };
      const text = opts.text ? this.fill(opts.text, att, def, ctx) : this.phrase(key, att, def, ctx);
      this.say('damage', text, { type: 'damage', target: def.id, amount: dmg, kind });
      this.checkDeath(def);
      return { outcome: blocked && !crit ? 'block' : 'hit', crit, blocked, dmg };
    }

    damage(f, n) { f.hp = Math.max(0, f.hp - n); }

    heal(f, amount, text, A = f) {
      const n = Math.min(amount, f.maxHp - f.hp);
      f.hp += n;
      this.say('heal', this.fill(text, A, f, { heal: `<dmg k="heal">+${n}</dmg>`, hp: this.hpTag(f) }), { type: 'heal', target: f.id, amount: n });
    }

    addEffect(f, effectId, source) {
      const def = this.data.effects[effectId];
      const existing = f.effects.find((e) => e.id === effectId);
      if (existing) existing.turns = Math.max(existing.turns, def.turns);
      else f.effects.push({ ...def, id: effectId, source: source && source.id });
      if (def.applyText) this.say('effect', this.fill(def.applyText, source || f, f));
    }

    isDisabled(f) { return f.effects.some((e) => e.disable); }

    checkDeath(f) {
      if (f.hp > 0 || f.dead) return;
      f.dead = true;
      const killer = this.opponentOf(f);
      this.say('death', this.phrase(f.isPlayer ? 'deathPlayer' : 'deathMonster', killer, f));
      this.ended = true;
      this.winner = killer;
    }

    // ---- Использование расходников: не тратит ход, но не чаще раза за ход ----

    canUseConsumable(f) { return !this.ended && f.usedConsumableTurn !== this.turn; }

    useConsumable(f, itemId) {
      const item = f.consumables.find((c) => c.id === itemId);
      if (!item || item.count <= 0 || !this.canUseConsumable(f)) return false;
      const def = this.data.consumables[itemId];
      item.count--;
      f.usedConsumableTurn = this.turn;
      if (def.heal) this.heal(f, def.heal, def.text);
      if (def.mana) {
        const n = Math.min(def.mana, f.maxMana - f.mana);
        f.mana += n;
        this.say('heal', this.fill(def.text, f, f, { heal: `<dmg k="mana">+${n}</dmg>` }), { type: 'mana', target: f.id, amount: n });
      }
      return true;
    }

    // ---- ИИ монстра ----

    chooseAiAction(f) {
      if (f.ai === 'idle') return { skillId: 'idle' };
      const usable = f.skills.filter((id) => id !== 'basic' && this.skillState(f, id).usable);
      const healing = usable.find((id) => this.data.skills[id].heals);
      if (healing && f.hp / f.maxHp < 0.4) return { skillId: healing };
      const attacks = usable.filter((id) => !this.data.skills[id].heals);
      if (attacks.length && this.rng.chance(75)) {
        // Предпочитает самый «дорогой» приём из доступных
        const weight = (id) => Object.values(this.data.skills[id].cost || {}).reduce((a, b) => a + b, 0);
        attacks.sort((a, b) => weight(b) - weight(a));
        return { skillId: attacks[0] };
      }
      return { skillId: 'basic' };
    }

    // ---- Ход: оба выбирают действие, затем действия разыгрываются по инициативе ----

    submit(skillId) {
      if (this.ended) return false;
      const st = skillId === 'basic' ? { usable: true } : this.skillState(this.player, skillId);
      if (!st.usable) return false;
      const actions = [
        { actor: this.player, skillId },
        { actor: this.monster, ...this.chooseAiAction(this.monster) },
      ];
      for (const a of actions) a.init = a.actor.stats.agi + this.rng.int(0, 6);
      actions.sort((x, y) => y.init - x.init);

      for (const a of actions) {
        if (this.ended) break;
        this.perform(a.actor, a.skillId);
      }
      if (!this.ended) this.endTurn();
      return true;
    }

    perform(actor, skillId) {
      const target = this.opponentOf(actor);
      const disabler = actor.effects.find((e) => e.disable);
      if (disabler) {
        this.say('passed', this.fill(disabler.skipText, actor, target));
        actor.effects = actor.effects.filter((e) => e !== disabler); // пропускает ровно одно действие
        return;
      }
      const skill = this.data.skills[skillId];
      if (skillId !== 'basic' && skillId !== 'idle' && !this.canAfford(actor, skill)) {
        skillId = 'basic'; // тактики могли сгореть до его очереди — бьёт обычным ударом
      }
      const s = this.data.skills[skillId];
      this.pay(actor, s);
      if (s.announce) this.say('skill', this.fill(this.rng.pick(s.announce), actor, target, { skill: `<skill>${s.name}</skill>` }));
      s.run(this, actor, target);
    }

    endTurn() {
      for (const f of this.fighters) {
        for (const e of f.effects) {
          if (e.dot && f.hp > 0 && !this.ended) {
            const n = this.rng.int(e.dot[0], e.dot[1]);
            this.damage(f, n);
            const kind = e.dotKind || 'dot';
            this.say('damage', this.fill(e.dotText, f, f, { dmg: this.dmgTag(n, kind), hp: this.hpTag(f) }), { type: 'damage', target: f.id, amount: n, kind });
            this.checkDeath(f);
          }
          if (!e.disable) e.turns--;
        }
        f.effects = f.effects.filter((e) => e.disable || e.turns > 0);
        for (const k of Object.keys(f.cooldowns)) f.cooldowns[k] = Math.max(0, f.cooldowns[k] - 1);
        f.mana = Math.min(f.maxMana, f.mana + 1 + Math.floor(f.stats.wis / 6));
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
  PC.formulas = formulas;
  PC.makeRng = makeRng;
  PC.TACTICS = TACTICS;
  if (typeof module !== 'undefined') module.exports = PC;
})(typeof window !== 'undefined' ? window : globalThis);
