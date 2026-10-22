package com.pocketcombats.battle.education;

import android.app.ActivityOptions;
import android.content.Intent;
import android.os.Bundle;
import android.util.Pair;
import android.view.View;
import android.widget.Button;
import androidx.fragment.app.FragmentActivity;
import co.mobiwise.materialintro.view.MaterialIntroView;
import com.pocketcombats.battle.BaseBattleFragment;
import com.pocketcombats.battle.education.LearnMechanicsFragment;
import com.pocketcombats.battle.m;
import com.pocketcombats.character.PlayerInfo;
import defpackage.bw0;
import defpackage.fx0;
import defpackage.hm0;
import defpackage.im0;
import defpackage.kc0;
import defpackage.kd;
import defpackage.le1;
import defpackage.lz;
import defpackage.mf1;
import defpackage.mj1;
import defpackage.mk;
import defpackage.n30;
import defpackage.nj1;
import defpackage.o30;
import defpackage.pc;
import defpackage.pk0;
import defpackage.ry0;
import defpackage.uc;
import defpackage.xs;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;

/* loaded from: classes.dex */
public class LearnMechanicsFragment extends BaseBattleFragment {
    public static final /* synthetic */ int B0 = 0;
    public fx0 w0;
    public Button x0;
    public Button y0;
    public long z0 = 1;
    public int A0 = 1;

    public LearnMechanicsFragment() {
        r0(true);
    }

    public static String P0(String str) {
        return bw0.c("<character id=\"122\" nick=\"", str, "\" team=\"2\" npc=\"true\" />");
    }

    @Override // com.pocketcombats.battle.BaseBattleFragment
    public final void J0() {
    }

    @Override // com.pocketcombats.battle.BaseBattleFragment
    public final void M0(long j, long j2) {
        this.x0.setEnabled(false);
        this.y0.setEnabled(false);
        int i = this.A0;
        if (i == 1) {
            long j3 = this.z0;
            this.z0 = j3 + 1;
            onBattleLogRecordAdded(new uc(j3, i, uc.a.DAMAGE, 121L, Collections.singletonList(122L), Q0() + ", стараясь произвести впечатление на своих учителей, ловко ткнул локтем по " + P0("Учебному манекену") + " <damage>-2</damage> [6/8]."));
            long j4 = this.z0;
            this.z0 = j4 + 1;
            onBattleLogRecordAdded(new uc(j4, this.A0, uc.a.NEW_TURN, -1L, Collections.emptyList(), null));
            lz b = lz.b();
            long j5 = this.z0;
            this.z0 = 1 + j5;
            b.e(new xs(j5, 122L, 2, 2, 6));
            lz.b().e(new mj1(new nj1(1, 0, 0, 0, 20)));
            View view = this.G;
            view.postDelayed(new ry0(6, this, view), 200L);
        } else if (i == 2) {
            long j6 = this.z0;
            this.z0 = j6 + 1;
            onBattleLogRecordAdded(new uc(j6, i, uc.a.DAMAGE, 121L, Collections.singletonList(122L), Q0() + " засмотрелся по сторонам, и деревянный " + P0("Учебный манекен") + " заблокировал пинок ученика <damage block=\"1\">-1</damage> [5/8]."));
            lz b2 = lz.b();
            long j7 = this.z0;
            this.z0 = 1 + j7;
            b2.e(new xs(j7, 122L, 2, 1, 5));
            View view2 = this.G;
            view2.postDelayed(new i(this, view2), 200L);
        } else if (i == 4) {
            long j8 = this.z0;
            this.z0 = j8 + 1;
            onBattleLogRecordAdded(new uc(j8, i, uc.a.DAMAGE, 121L, Collections.singletonList(122L), "Старательный " + Q0() + " провёл мастерский удар по " + P0("Учебному манекену") + " <damage>-1</damage> [4/8]."));
            lz b3 = lz.b();
            long j9 = this.z0;
            this.z0 = 1 + j9;
            b3.e(new xs(j9, 122L, 2, 2, 4));
            lz.b().e(new mj1(new nj1(2, 1, 0, 0, 20)));
            View view3 = this.G;
            view3.postDelayed(new j(this), 800L);
            view3.postDelayed(new k(this, view3), 1000L);
        } else if (i == 5 && j != 1) {
            long j10 = this.z0;
            this.z0 = j10 + 1;
            onBattleLogRecordAdded(new uc(j10, i, uc.a.DAMAGE, 121L, Collections.singletonList(122L), Q0() + ", используя приём <skill id=\"2\" title=\"Сосредоточенный удар\"/>, показал лучшее, на что он способен и нанёс критический удар по " + P0("Учебному манекену") + " <crit>-4</crit> [0/8]."));
            lz b4 = lz.b();
            long j11 = this.z0;
            this.z0 = 1 + j11;
            b4.e(new xs(j11, 122L, 2, 4, 0));
            lz.b().e(new mj1(new nj1(0, 0, 1, 0, 20)));
            this.V.k(true);
            this.V.a(true);
            z0();
            FragmentActivity v = v();
            Intent intent = new Intent(v, (Class<?>) EducationFinishedActivity.class);
            ArrayList arrayList = new ArrayList();
            arrayList.add(Pair.create(v.findViewById(m.h.app_bar), "app-bar"));
            arrayList.add(Pair.create(v.findViewById(m.h.toolbar_menu_button), "toolbar-menu-button"));
            Pair[] pairArr = new Pair[arrayList.size()];
            arrayList.toArray(pairArr);
            this.G.postDelayed(new l(this, intent, ActivityOptions.makeSceneTransitionAnimation(v, pairArr)), 1200L);
        }
        this.A0++;
        this.V.a(false);
    }

    @Override // androidx.fragment.app.a
    public final void O(Bundle bundle) {
        super.O(bundle);
        ((kc0) v().getApplication()).a(this);
        if (this.V == null) {
            LinkedHashMap linkedHashMap = new LinkedHashMap();
            PlayerInfo c = this.w0.c();
            linkedHashMap.put(121L, new mk(121L, c.b, 1, false, 28, 28, 1, new nj1(0, 0, 0, 0, 20), c.l, c.k));
            LinkedHashMap linkedHashMap2 = new LinkedHashMap();
            linkedHashMap2.put(122L, new mk(122L, "Учебный манекен", 1, true, 8, 8, 2, new nj1(0, 0, 0, 0, 10), "https://static.pocketcombats.com/v2/icon/simulator.png", "http://static.pocketcombats.com/v2/npc/simulator.png"));
            ArrayList arrayList = new ArrayList();
            long j = this.z0;
            this.z0 = j + 1;
            arrayList.add(new uc(j, 0, uc.a.POETRY, -1L, Collections.emptyList(), "Прибил комара —\nи брызнуло свежей кровью\nна книжку о войне..."));
            long j2 = this.z0;
            this.z0 = 1 + j2;
            arrayList.add(new uc(j2, this.A0, uc.a.NEW_TURN, -1L, Collections.emptyList(), null));
            pc pcVar = new pc();
            pcVar.n(-1L);
            pcVar.j(new ArrayList());
            kd kdVar = new kd();
            kdVar.h(2);
            kdVar.g("https://static.pocketcombats.com/v2/skill/hit_strong.png");
            kdVar.m("Сосредоточенный удар");
            kdVar.e("Максимально сосредоточиться и нанести удар по Учебному манекену.");
            kdVar.j(new nj1(2, 1, 0, 0, 0));
            kdVar.k(le1.NONE);
            pcVar.e(Collections.singletonList(kdVar));
            pcVar.x(this.A0);
            pcVar.k(false);
            pcVar.g(121L);
            pcVar.v(1);
            pcVar.b(new ArrayList(linkedHashMap.values()));
            pcVar.m(new ArrayList(linkedHashMap2.values()));
            pcVar.u(((mk) linkedHashMap.get(121L)).g);
            pcVar.w(-1);
            pcVar.s(System.currentTimeMillis());
            pcVar.q(-1L);
            pcVar.o(arrayList);
            pcVar.a(false);
            this.V = pcVar;
        }
    }

    @Override // com.pocketcombats.battle.BaseBattleFragment
    public final void O0(nj1 nj1Var) {
        this.y0.setEnabled(false);
    }

    public final String Q0() {
        return mf1.s(new StringBuilder("<character id=\"121\" nick=\""), this.w0.c().b, "\" team=\"1\" />");
    }

    public final void R0(View view) {
        int i = this.A0;
        n30 n30Var = n30.ALL;
        o30 o30Var = o30.CENTER;
        final int i2 = 0;
        final int i3 = 1;
        if (i == 1) {
            new hm0(v()).u("basic-hit-showcase");
            im0 im0Var = new im0(v(), 11);
            Object obj = im0Var.a;
            ((MaterialIntroView) obj).w = false;
            ((MaterialIntroView) obj).y = false;
            ((MaterialIntroView) obj).h = o30Var;
            ((MaterialIntroView) obj).g = n30Var;
            ((MaterialIntroView) obj).b = 500;
            ((MaterialIntroView) obj).d = true;
            ((MaterialIntroView) obj).D = true;
            im0Var.F("В начале боя, как правило, доступно только одно действие — Обычный удар.\nНажмите, чтобы ударить по Учебному манекену.");
            ((MaterialIntroView) im0Var.a).E = 2;
            im0Var.H(view.findViewById(m.h.battle_action_basic_hit));
            ((MaterialIntroView) im0Var.a).A = "basic-hit-showcase";
            im0Var.I();
            return;
        }
        if (i == 2) {
            new hm0(v()).u("tactics-showcase");
            im0 im0Var2 = new im0(v(), 11);
            Object obj2 = im0Var2.a;
            ((MaterialIntroView) obj2).w = false;
            ((MaterialIntroView) obj2).y = false;
            ((MaterialIntroView) obj2).h = o30Var;
            ((MaterialIntroView) obj2).g = n30Var;
            ((MaterialIntroView) obj2).b = 500;
            ((MaterialIntroView) obj2).d = true;
            ((MaterialIntroView) obj2).q = true;
            ((MaterialIntroView) obj2).D = false;
            im0Var2.F("Вы попали по Учебному манекену.\nМанекен теряет здоровье, а вы зарабатываете Тактику Атаки.\n\nТактики расходуются при использовании Приёмов.\nПока у вас нет необходимого количества тактик, чтобы использовать какой-нибудь приём, но вы накопите их по ходу боя!");
            ((MaterialIntroView) im0Var2.a).E = 1;
            im0Var2.H(view.findViewById(m.h.tactics_hit));
            Object obj3 = im0Var2.a;
            ((MaterialIntroView) obj3).A = "tactics-showcase";
            ((MaterialIntroView) obj3).C = new pk0(this) { // from class: rf0
                public final /* synthetic */ LearnMechanicsFragment b;

                {
                    this.b = this;
                }

                @Override // defpackage.pk0
                public final void a() {
                    int i4 = 10;
                    int i5 = i2;
                    LearnMechanicsFragment learnMechanicsFragment = this.b;
                    switch (i5) {
                        case 0:
                            int i6 = LearnMechanicsFragment.B0;
                            learnMechanicsFragment.x0.postDelayed(new ky0(learnMechanicsFragment, i4), 270L);
                            break;
                        default:
                            int i7 = LearnMechanicsFragment.B0;
                            learnMechanicsFragment.x0.postDelayed(new ky0(learnMechanicsFragment, i4), 270L);
                            break;
                    }
                }
            };
            im0Var2.I();
            return;
        }
        if (i == 3) {
            new hm0(v()).u("missed-hit-showcase");
            im0 im0Var3 = new im0(v(), 11);
            Object obj4 = im0Var3.a;
            ((MaterialIntroView) obj4).w = false;
            ((MaterialIntroView) obj4).y = false;
            ((MaterialIntroView) obj4).h = o30Var;
            ((MaterialIntroView) obj4).g = n30Var;
            ((MaterialIntroView) obj4).b = 500;
            ((MaterialIntroView) obj4).d = true;
            ((MaterialIntroView) obj4).q = true;
            ((MaterialIntroView) obj4).D = false;
            im0Var3.F("В этот раз вы попали в блок.\nКогда оппонент блокирует ваши атаки, он получается вдвое меньше урона, а вы не получаете никаких Тактик.");
            ((MaterialIntroView) im0Var3.a).E = 1;
            im0Var3.H(view.findViewById(m.h.tactics_hit));
            Object obj5 = im0Var3.a;
            ((MaterialIntroView) obj5).A = "missed-hit-showcase";
            ((MaterialIntroView) obj5).C = new h(this, view);
            im0Var3.I();
            return;
        }
        if (i == 4) {
            new hm0(v()).u("block-showcase");
            im0 im0Var4 = new im0(v(), 11);
            Object obj6 = im0Var4.a;
            ((MaterialIntroView) obj6).w = false;
            ((MaterialIntroView) obj6).y = false;
            ((MaterialIntroView) obj6).h = o30Var;
            ((MaterialIntroView) obj6).g = n30Var;
            ((MaterialIntroView) obj6).b = 500;
            ((MaterialIntroView) obj6).d = true;
            ((MaterialIntroView) obj6).q = true;
            ((MaterialIntroView) obj6).D = false;
            im0Var4.F("Вы заблокировали атаку противника!\nЗа блокирование атак противника вы получаете Тактику Блокирования.\nУвеличить шанс блокирования атак можно с помощью соответствующих предметов экипировки.");
            ((MaterialIntroView) im0Var4.a).E = 1;
            im0Var4.H(view.findViewById(m.h.tactics_block));
            Object obj7 = im0Var4.a;
            ((MaterialIntroView) obj7).A = "block-showcase";
            ((MaterialIntroView) obj7).C = new pk0(this) { // from class: rf0
                public final /* synthetic */ LearnMechanicsFragment b;

                {
                    this.b = this;
                }

                @Override // defpackage.pk0
                public final void a() {
                    int i4 = 10;
                    int i5 = i3;
                    LearnMechanicsFragment learnMechanicsFragment = this.b;
                    switch (i5) {
                        case 0:
                            int i6 = LearnMechanicsFragment.B0;
                            learnMechanicsFragment.x0.postDelayed(new ky0(learnMechanicsFragment, i4), 270L);
                            break;
                        default:
                            int i7 = LearnMechanicsFragment.B0;
                            learnMechanicsFragment.x0.postDelayed(new ky0(learnMechanicsFragment, i4), 270L);
                            break;
                    }
                }
            };
            im0Var4.I();
            return;
        }
        if (i != 5) {
            return;
        }
        this.y0.setEnabled(true);
        new hm0(v()).u("skill-showcase");
        im0 im0Var5 = new im0(v(), 11);
        Object obj8 = im0Var5.a;
        ((MaterialIntroView) obj8).w = false;
        ((MaterialIntroView) obj8).y = false;
        ((MaterialIntroView) obj8).h = o30Var;
        ((MaterialIntroView) obj8).g = n30Var;
        ((MaterialIntroView) obj8).b = 500;
        ((MaterialIntroView) obj8).d = true;
        ((MaterialIntroView) obj8).q = true;
        ((MaterialIntroView) obj8).D = true;
        im0Var5.F("Вы накопили достаточно Тактик, чтобы использовать Приём!\n\nИндикатор показывает количество приёмов, для использования которых накоплено достаточное количество тактик.");
        ((MaterialIntroView) im0Var5.a).E = 2;
        im0Var5.H(view.findViewById(m.h.skill_selector));
        ((MaterialIntroView) im0Var5.a).A = "skill-showcase";
        im0Var5.I();
    }

    @Override // com.pocketcombats.battle.BaseBattleFragment, androidx.fragment.app.a
    public final void b0(View view, Bundle bundle) {
        super.b0(view, bundle);
        this.x0 = (Button) view.findViewById(m.h.battle_action_basic_hit);
        Button button = (Button) view.findViewById(m.h.skill_selector);
        this.y0 = button;
        button.setEnabled(false);
    }

    @Override // androidx.fragment.app.a
    public final void c0() {
        this.E = true;
        View view = this.G;
        N0(view, this.V);
        R0(view);
    }
}
