import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Body, Button, Caption, Card, Meter, Row, Screen, Title } from '../../src/components/ui';
import { goalMonthlyRequirement, isEgpGoal } from '../../src/domain';
import { formatEgp } from '../../src/domain/money';
import { useLocalization, usePalette, useSafeSpend } from '../../src/store/selectors';
import { useLedger } from '../../src/store/useLedger';
import { FONT, RADIUS, SPACE } from '../../src/theme/tokens';

type Segment = 'commit' | 'budgets' | 'people' | 'goals';

/**
 * Plan — the forward-looking half of the app: what is already claimed against
 * the salary before any of it can be spent freely.
 *
 * Segmented rather than one long scroll, because these four are answers to
 * four different questions and mixing them makes none of them scannable.
 */
export default function PlanScreen() {
  const p = usePalette();
  const { t, lang, money, num, rtl } = useLocalization();
  const insets = useSafeAreaInsets();
  const [seg, setSeg] = useState<Segment>('commit');

  const c = useSafeSpend();
  const ledger = useLedger((s) => s.ledger);
  const fxRate = useLedger((s) => s.settings.fxRate);
  const updateCommitment = useLedger((s) => s.updateCommitment);
  const removeCommitment = useLedger((s) => s.removeCommitment);

  const segments: { id: Segment; label: string }[] = [
    { id: 'commit', label: t('segCommit') },
    { id: 'budgets', label: t('segBudgets') },
    { id: 'people', label: t('segPeople') },
    { id: 'goals', label: t('segGoals') },
  ];

  // Category spend for the current month, for the budget meters.
  const monthSpendByCat = useMemo(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const acc = new Map<string, number>();
    for (const x of ledger.tx) {
      if (x.type !== 'expense' || x.ts < start || !x.cat) continue;
      acc.set(x.cat, (acc.get(x.cat) ?? 0) + x.amt);
    }
    return acc;
  }, [ledger.tx]);

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{
          padding: SPACE.lg,
          paddingTop: insets.top + SPACE.lg,
          paddingBottom: SPACE.xxl,
        }}
      >
        <Title>{t('navPlan')}</Title>

        <View style={[styles.segments, { flexDirection: rtl ? 'row-reverse' : 'row' }]}>
          {segments.map((s) => {
            const on = seg === s.id;
            return (
              <Pressable
                key={s.id}
                onPress={() => setSeg(s.id)}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                style={[
                  styles.segment,
                  { borderColor: on ? p.accent : p.faint, backgroundColor: on ? p.accentWash : 'transparent' },
                ]}
              >
                <Text style={{ color: on ? p.accentDeep : p.ink, fontSize: FONT.small }}>{s.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {seg === 'commit' && (
          <Card>
            <Title>{t('segCommit')}</Title>
            <Caption>{t('commitNote')}</Caption>
            {ledger.commits.length === 0 ? (
              <Body muted style={{ marginTop: SPACE.lg }}>
                {t('upcomingEmpty')}
              </Body>
            ) : (
              <View style={{ marginTop: SPACE.sm }}>
                {ledger.commits.map((k) => (
                  <View key={k.id}>
                    <Row
                      label={`${k[lang]}${k.day ? ` · ${t('dayOfMonth')} ${k.day}` : ''}`}
                      value={k.amt != null ? money(k.amt) : t('enterAmount')}
                      valueColor={k.paused ? p.sub : p.ink}
                    />
                    <View style={[styles.actions, { flexDirection: rtl ? 'row-reverse' : 'row' }]}>
                      <Button
                        label={k.paused ? t('resume') : t('pause')}
                        variant="secondary"
                        onPress={() => updateCommitment(k.id, { paused: !k.paused })}
                      />
                      <Button
                        label={k.paidMonth ? t('resume') : t('payNow')}
                        variant="secondary"
                        onPress={() => updateCommitment(k.id, { paidMonth: !k.paidMonth })}
                      />
                      <Button label={t('del')} variant="secondary" onPress={() => removeCommitment(k.id)} />
                    </View>
                  </View>
                ))}
                <Row label={t('upcoming')} value={money(c.commitObl)} valueColor={p.negative} />
              </View>
            )}
          </Card>
        )}

        {seg === 'budgets' && (
          <Card>
            <Title>{t('segBudgets')}</Title>
            <Caption>{t('budgetNote')}</Caption>
            <View style={{ marginTop: SPACE.md }}>
              {ledger.cats.map((cat) => {
                const budget = ledger.budgets[cat.id];
                const spent = monthSpendByCat.get(cat.id) ?? 0;
                const ratio = budget && budget > 0 ? spent / budget : 0;
                const over = budget != null && spent > budget;
                return (
                  <View key={cat.id} style={{ marginBottom: SPACE.lg }}>
                    <Row
                      label={cat[lang]}
                      value={budget != null ? `${money(spent)} / ${money(budget)}` : money(spent)}
                      valueColor={over ? p.negative : p.ink}
                    />
                    {budget != null && <Meter ratio={ratio} color={over ? p.negative : p.accent} />}
                  </View>
                );
              })}
            </View>
          </Card>
        )}

        {seg === 'people' && (
          <Card>
            <Title>{t('peopleDebts')}</Title>
            <Caption>{t('recvNote')}</Caption>
            {ledger.people.length === 0 ? (
              <Body muted style={{ marginTop: SPACE.lg }}>
                {t('peopleEmpty')}
              </Body>
            ) : (
              <View style={{ marginTop: SPACE.sm }}>
                {ledger.people.map((person) => (
                  <Row
                    key={person.id}
                    label={`${person.name} · ${person.dir === 'owe' ? t('iOwe') : t('owedToMe')}`}
                    value={money(person.out)}
                    valueColor={person.dir === 'owe' ? p.negative : p.positive}
                  />
                ))}
              </View>
            )}
          </Card>
        )}

        {seg === 'goals' && (
          <Card>
            <Title>{t('goals')}</Title>
            <Caption>{t('goalNote')}</Caption>
            {ledger.goals.length === 0 ? (
              <Body muted style={{ marginTop: SPACE.lg }}>
                {t('goalsEmpty')}
              </Body>
            ) : (
              <View style={{ marginTop: SPACE.sm }}>
                {ledger.goals.map((g) => {
                  const egp = isEgpGoal(g);
                  // Progress is measured in the goal's own currency so the bar
                  // matches the target the user actually typed in.
                  const held = egp ? g.alloc * fxRate + (g.extEgp ?? 0) : g.alloc;
                  const ratio = g.target ? held / g.target : 0;
                  const perMonth = goalMonthlyRequirement(g, fxRate);
                  return (
                    <View key={g.id} style={{ marginBottom: SPACE.lg }}>
                      <Row
                        label={g.id}
                        value={
                          g.target
                            ? egp
                              ? `${formatEgp(held, lang)} / ${formatEgp(g.target, lang)}`
                              : `${money(held)} / ${money(g.target)}`
                            : money(held)
                        }
                      />
                      {g.target != null && <Meter ratio={ratio} />}
                      {perMonth > 0 && (
                        <Caption style={{ marginTop: SPACE.sm }}>
                          {money(perMonth)} · {num(g.months ?? 0)} {t('monthsW')}
                        </Caption>
                      )}
                    </View>
                  );
                })}
                <Row label={t('goals')} value={money(c.goalReq)} valueColor={p.accentDeep} />
              </View>
            )}
          </Card>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  segments: { gap: SPACE.sm, marginVertical: SPACE.lg, flexWrap: 'wrap' },
  segment: {
    paddingVertical: SPACE.sm,
    paddingHorizontal: SPACE.md,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
  },
  actions: { gap: SPACE.sm, paddingVertical: SPACE.sm, flexWrap: 'wrap' },
});
