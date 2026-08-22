import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Chips, DayPicker, Sheet, TextField } from '../../src/components/fields';
import { Body, Button, Caption, Card, Meter, Row, Screen, Title } from '../../src/components/ui';
import {
  formatEgp,
  goalMonthlyRequirement,
  isEgpGoal,
  parseAmount,
  type Account,
  type DebtDirection,
} from '../../src/domain';
import { useLocalization, usePalette, useSafeSpend } from '../../src/store/selectors';
import { useLedger } from '../../src/store/useLedger';
import { FONT, RADIUS, SPACE } from '../../src/theme/tokens';

type Segment = 'commit' | 'budgets' | 'people' | 'goals';

/**
 * Plan — everything already claimed against the salary before any of it can be
 * spent freely, and the only place those claims can be edited.
 *
 * Segmented rather than one long scroll: these four answer four different
 * questions, and mixing them makes none of them scannable.
 */
export default function PlanScreen() {
  const p = usePalette();
  const { t, lang, money, num, rtl } = useLocalization();
  const insets = useSafeAreaInsets();
  const [seg, setSeg] = useState<Segment>('commit');

  const c = useSafeSpend();
  const ledger = useLedger((s) => s.ledger);
  const fxRate = useLedger((s) => s.settings.fxRate);

  const addCommitment = useLedger((s) => s.addCommitment);
  const updateCommitment = useLedger((s) => s.updateCommitment);
  const removeCommitment = useLedger((s) => s.removeCommitment);
  const addPerson = useLedger((s) => s.addPerson);
  const removePerson = useLedger((s) => s.removePerson);
  const settlePerson = useLedger((s) => s.settlePerson);
  const addGoal = useLedger((s) => s.addGoal);
  const updateGoal = useLedger((s) => s.updateGoal);
  const removeGoal = useLedger((s) => s.removeGoal);
  const setBudget = useLedger((s) => s.setBudget);
  const addCategory = useLedger((s) => s.addCategory);

  // ---- sheet state --------------------------------------------------------
  const [sheet, setSheet] = useState<
    | null
    | { kind: 'commit'; id?: string }
    | { kind: 'budget'; catId: string }
    | { kind: 'category' }
    | { kind: 'person' }
    | { kind: 'settle'; id: string }
    | { kind: 'goal'; id?: string }
  >(null);

  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [day, setDay] = useState<number | null>(null);
  const [months, setMonths] = useState('');
  const [dir, setDir] = useState<DebtDirection>('owe');
  const [currency, setCurrency] = useState<'AED' | 'EGP'>('AED');
  const [acct, setAcct] = useState<Account>('bank');

  function openSheet(next: NonNullable<typeof sheet>) {
    // Prefill from the record being edited, so an edit sheet never starts blank
    // and silently wipes what was there.
    if (next.kind === 'commit' && next.id) {
      const k = ledger.commits.find((x) => x.id === next.id);
      setName(k ? k[lang] : '');
      setAmount(k?.amt != null ? String(k.amt) : '');
      setDay(k?.day ?? null);
    } else if (next.kind === 'goal' && next.id) {
      const g = ledger.goals.find((x) => x.id === next.id);
      setName(g ? g[lang] : '');
      setAmount(g?.target != null ? String(g.target) : '');
      setMonths(g?.months != null ? String(g.months) : '');
      setCurrency(g && isEgpGoal(g) ? 'EGP' : 'AED');
    } else if (next.kind === 'budget') {
      setAmount(String(ledger.budgets[next.catId] ?? ''));
    } else if (next.kind === 'settle') {
      const person = ledger.people.find((x) => x.id === next.id);
      setAmount(person ? String(person.out) : '');
      setAcct('bank');
    } else {
      setName('');
      setAmount('');
      setDay(null);
      setMonths('');
      setDir('owe');
      setCurrency('AED');
    }
    setSheet(next);
  }

  function closeSheet() {
    setSheet(null);
  }

  const amountVal = parseAmount(amount);
  const monthsVal = parseAmount(months);

  function submit() {
    if (!sheet) return;
    switch (sheet.kind) {
      case 'commit': {
        if (!name.trim()) return;
        const patch = { ar: name.trim(), en: name.trim(), amt: amountVal, day };
        if (sheet.id) updateCommitment(sheet.id, patch);
        else addCommitment({ ...patch, paused: false, paidMonth: false });
        break;
      }
      case 'budget':
        setBudget(sheet.catId, amountVal != null && amountVal > 0 ? amountVal : null);
        break;
      case 'category':
        if (!name.trim()) return;
        addCategory(name.trim(), name.trim());
        break;
      case 'person': {
        if (!name.trim() || amountVal == null || amountVal <= 0) return;
        addPerson({ name: name.trim(), amt: amountVal, out: amountVal, dir, fromAcct: 'bank' });
        break;
      }
      case 'settle': {
        if (amountVal == null || amountVal <= 0) return;
        settlePerson(sheet.id, amountVal, acct);
        break;
      }
      case 'goal': {
        if (!name.trim()) return;
        const patch = {
          ar: name.trim(),
          en: name.trim(),
          currency,
          target: amountVal,
          months: monthsVal != null && monthsVal > 0 ? Math.round(monthsVal) : null,
        };
        if (sheet.id) updateGoal(sheet.id, patch);
        else addGoal({ ...patch, alloc: 0, extEgp: 0, auto: false });
        break;
      }
    }
    closeSheet();
  }

  function confirmDelete(label: string, onConfirm: () => void) {
    Alert.alert(label, t('deleteConfirm'), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('del'), style: 'destructive', onPress: onConfirm },
    ]);
  }

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

  const segments: { id: Segment; label: string }[] = [
    { id: 'commit', label: t('segCommit') },
    { id: 'budgets', label: t('segBudgets') },
    { id: 'people', label: t('segPeople') },
    { id: 'goals', label: t('segGoals') },
  ];

  const sheetTitle = () => {
    if (!sheet) return '';
    switch (sheet.kind) {
      case 'commit': return sheet.id ? t('editCommit') : t('addCommit');
      case 'budget': return t('setBudget');
      case 'category': return t('addCategory');
      case 'person': return t('addPerson');
      case 'settle': return t('settle');
      case 'goal': return sheet.id ? t('editGoal') : t('addGoal');
    }
  };

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

        {/* ---- commitments ---- */}
        {seg === 'commit' && (
          <Card>
            <Title>{t('segCommit')}</Title>
            <Caption>{t('commitNote')}</Caption>

            {ledger.commits.length === 0 ? (
              <Body muted style={{ marginTop: SPACE.lg }}>{t('upcomingEmpty')}</Body>
            ) : (
              <View style={{ marginTop: SPACE.sm }}>
                {ledger.commits.map((k) => (
                  <View key={k.id} style={{ marginBottom: SPACE.md }}>
                    <Row
                      label={`${k[lang]}${k.day ? ` · ${t('dayOfMonth')} ${k.day}` : ''}`}
                      value={k.amt != null ? money(k.amt) : t('enterAmount')}
                      valueColor={k.paused || k.paidMonth ? p.sub : p.ink}
                      onPress={() => openSheet({ kind: 'commit', id: k.id })}
                    />
                    <View style={[styles.actions, { flexDirection: rtl ? 'row-reverse' : 'row' }]}>
                      <Button
                        label={k.paidMonth ? t('markUnpaid') : t('payNow')}
                        variant="secondary"
                        onPress={() => updateCommitment(k.id, { paidMonth: !k.paidMonth })}
                      />
                      <Button
                        label={k.paused ? t('resume') : t('pause')}
                        variant="secondary"
                        onPress={() => updateCommitment(k.id, { paused: !k.paused })}
                      />
                      <Button
                        label={t('del')}
                        variant="secondary"
                        onPress={() => confirmDelete(k[lang], () => removeCommitment(k.id))}
                      />
                    </View>
                  </View>
                ))}
                <Row label={t('upcoming')} value={money(c.commitObl)} valueColor={p.negative} />
              </View>
            )}

            <View style={{ marginTop: SPACE.lg }}>
              <Button label={t('addCommit')} onPress={() => openSheet({ kind: 'commit' })} />
            </View>
          </Card>
        )}

        {/* ---- budgets ---- */}
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
                      onPress={() => openSheet({ kind: 'budget', catId: cat.id })}
                    />
                    {budget != null && <Meter ratio={ratio} color={over ? p.negative : p.accent} />}
                  </View>
                );
              })}
            </View>
            <Button label={t('addCategory')} variant="secondary" onPress={() => openSheet({ kind: 'category' })} />
          </Card>
        )}

        {/* ---- people ---- */}
        {seg === 'people' && (
          <Card>
            <Title>{t('peopleDebts')}</Title>
            <Caption>{t('recvNote')}</Caption>

            {ledger.people.length === 0 ? (
              <Body muted style={{ marginTop: SPACE.lg }}>{t('peopleEmpty')}</Body>
            ) : (
              <View style={{ marginTop: SPACE.sm }}>
                {ledger.people.map((person) => (
                  <View key={person.id} style={{ marginBottom: SPACE.md }}>
                    <Row
                      label={`${person.name} · ${person.dir === 'owe' ? t('iOwe') : t('owedToMe')}`}
                      value={money(person.out)}
                      valueColor={person.dir === 'owe' ? p.negative : p.positive}
                    />
                    <View style={[styles.actions, { flexDirection: rtl ? 'row-reverse' : 'row' }]}>
                      {person.out > 0 && (
                        <Button
                          label={person.dir === 'owe' ? t('payNow') : t('markReceived')}
                          variant="secondary"
                          onPress={() => openSheet({ kind: 'settle', id: person.id })}
                        />
                      )}
                      <Button
                        label={t('del')}
                        variant="secondary"
                        onPress={() => confirmDelete(person.name, () => removePerson(person.id))}
                      />
                    </View>
                  </View>
                ))}
              </View>
            )}

            <View style={{ marginTop: SPACE.lg }}>
              <Button label={t('addPerson')} onPress={() => openSheet({ kind: 'person' })} />
            </View>
          </Card>
        )}

        {/* ---- goals ---- */}
        {seg === 'goals' && (
          <Card>
            <Title>{t('goals')}</Title>
            <Caption>{t('goalNote')}</Caption>

            {ledger.goals.length === 0 ? (
              <Body muted style={{ marginTop: SPACE.lg }}>{t('goalsEmpty')}</Body>
            ) : (
              <View style={{ marginTop: SPACE.sm }}>
                {ledger.goals.map((g) => {
                  const egp = isEgpGoal(g);
                  // Progress is shown in the goal's own currency so the bar
                  // matches the target the user actually typed in.
                  const held = egp ? g.alloc * fxRate + (g.extEgp ?? 0) : g.alloc;
                  const ratio = g.target ? held / g.target : 0;
                  const perMonth = goalMonthlyRequirement(g, fxRate);
                  const fmt = (n: number) => (egp ? formatEgp(n, lang) : money(n));
                  return (
                    <View key={g.id} style={{ marginBottom: SPACE.lg }}>
                      <Row
                        label={g[lang]}
                        value={g.target ? `${fmt(held)} / ${fmt(g.target)}` : fmt(held)}
                        onPress={() => openSheet({ kind: 'goal', id: g.id })}
                      />
                      {g.target != null && <Meter ratio={ratio} />}
                      <Caption style={{ marginTop: SPACE.sm }}>
                        {perMonth > 0
                          ? `${money(perMonth)} / ${t('monthsW')} · ${num(g.months ?? 0)} ${t('monthsW')}`
                          : t('goalNoSchedule')}
                      </Caption>
                      <View style={[styles.actions, { flexDirection: rtl ? 'row-reverse' : 'row' }]}>
                        <Button
                          label={t('del')}
                          variant="secondary"
                          onPress={() => confirmDelete(g[lang], () => removeGoal(g.id))}
                        />
                      </View>
                    </View>
                  );
                })}
                <Row label={t('goals')} value={money(c.goalReq)} valueColor={p.accentDeep} />
              </View>
            )}

            <View style={{ marginTop: SPACE.lg, gap: SPACE.sm }}>
              <Button label={t('goalPlanT')} onPress={() => router.push('/goal-plan')} />
              <Button label={t('addGoal')} variant="secondary" onPress={() => openSheet({ kind: 'goal' })} />
            </View>
          </Card>
        )}
      </ScrollView>

      {/* ---- sheets ---- */}
      <Sheet
        visible={sheet != null}
        title={sheetTitle()}
        onClose={closeSheet}
        onSubmit={submit}
        submitLabel={t('save')}
        canSubmit={
          sheet?.kind === 'commit' || sheet?.kind === 'goal' || sheet?.kind === 'category'
            ? name.trim().length > 0
            : sheet?.kind === 'person'
              ? name.trim().length > 0 && (amountVal ?? 0) > 0
              : sheet?.kind === 'settle'
                ? (amountVal ?? 0) > 0
                : true
        }
      >
        {sheet?.kind === 'commit' && (
          <>
            <TextField label={t('commitNamePh')} value={name} onChange={setName} />
            <TextField label={t('enterAmount')} value={amount} onChange={setAmount} numeric big />
            <DayPicker label={t('dayOfMonth')} value={day} onChange={setDay} />
          </>
        )}

        {sheet?.kind === 'budget' && (
          <TextField label={t('setBudget')} hint={t('budgetZeroHint')} value={amount} onChange={setAmount} numeric big />
        )}

        {sheet?.kind === 'category' && (
          <TextField label={t('addCategory')} value={name} onChange={setName} />
        )}

        {sheet?.kind === 'person' && (
          <>
            <TextField label={t('personPh')} value={name} onChange={setName} />
            <TextField label={t('enterAmount')} value={amount} onChange={setAmount} numeric big />
            <Chips
              label={t('direction')}
              value={dir}
              onChange={setDir}
              options={[
                { id: 'owe', label: t('iOwe') },
                { id: 'owed', label: t('owedToMe') },
              ]}
            />
          </>
        )}

        {sheet?.kind === 'settle' && (
          <>
            <TextField label={t('enterAmount')} value={amount} onChange={setAmount} numeric big />
            <Chips
              label={t('account')}
              value={acct}
              onChange={setAcct}
              options={[
                { id: 'bank', label: t('bankAcct') },
                { id: 'cash', label: t('cashAcct') },
              ]}
            />
          </>
        )}

        {sheet?.kind === 'goal' && (
          <>
            <TextField label={t('goalNamePh')} value={name} onChange={setName} />
            <Chips
              label={t('currency')}
              hint={t('currencyHint')}
              value={currency}
              onChange={setCurrency}
              options={[
                { id: 'AED', label: lang === 'ar' ? 'د.إ' : 'AED' },
                { id: 'EGP', label: lang === 'ar' ? 'ج.م' : 'EGP' },
              ]}
            />
            <TextField label={t('goalTarget')} value={amount} onChange={setAmount} numeric big />
            <TextField label={t('monthsLeft')} hint={t('monthsHint')} value={months} onChange={setMonths} numeric />
          </>
        )}
      </Sheet>
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
