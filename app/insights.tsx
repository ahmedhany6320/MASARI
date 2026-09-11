import { Stack, router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Chips } from '../src/components/fields';
import { Body, Button, Caption, Card, Meter, Row, Screen, Title } from '../src/components/ui';
import {
  analyticsReadiness,
  burnRate,
  categoryStats,
  detectRecurring,
  formatEgp,
  goalProjection,
  isEgpGoal,
  merchantStats,
  monthComparison,
  safeSpend,
  savingSummary,
  underLimitStreak,
} from '../src/domain';
import { MONTHS } from '../src/i18n';
import { useLocalization, usePalette } from '../src/store/selectors';
import { useLedger } from '../src/store/useLedger';
import { FONT, RADIUS, SPACE } from '../src/theme/tokens';

type Window = 30 | 90 | 365;

/**
 * Insights — where the money actually goes, and when the goals land.
 *
 * The ordering is deliberate: the goal projection comes first because it is
 * the only screen in the app that answers "is this working", and everything
 * below it explains why the answer is what it is.
 */
export default function InsightsScreen() {
  const p = usePalette();
  const { t, lang, money, num, rtl } = useLocalization();
  const insets = useSafeAreaInsets();

  const ledger = useLedger((s) => s.ledger);
  const fxRate = useLedger((s) => s.settings.fxRate);
  const [window, setWindow] = useState<Window>(30);

  const now = useMemo(() => new Date(), []);
  const since = useMemo(() => now.getTime() - window * 864e5, [now, window]);

  const c = useMemo(() => safeSpend(ledger, fxRate, now), [ledger, fxRate, now]);
  const sv = useMemo(() => savingSummary(ledger, now), [ledger, now]);
  const burn = useMemo(() => burnRate(ledger, c.livingPool, now), [ledger, c.livingPool, now]);
  const merchants = useMemo(() => merchantStats(ledger, since, 8), [ledger, since]);
  const cats = useMemo(() => categoryStats(ledger, since), [ledger, since]);
  const recurring = useMemo(() => detectRecurring(ledger, now), [ledger, now]);
  const comparison = useMemo(() => monthComparison(ledger, now), [ledger, now]);
  // Whether the data behind each view supports the conclusion it would draw.
  const ready = useMemo(() => analyticsReadiness(ledger, now), [ledger, now]);

  /** Shows a view only when it has the data, with a warning when it is thin. */
  const gate = (level: 'good' | 'thin' | 'insufficient', body: React.ReactNode) =>
    level === 'insufficient' ? (
      <Body muted style={{ marginTop: SPACE.md }}>{t('rdNone')}</Body>
    ) : (
      <>
        {level === 'thin' && (
          <Caption style={{ color: p.warn, marginTop: SPACE.xs }}>{t('rdThin')}</Caption>
        )}
        {body}
      </>
    );
  const streak = useMemo(() => underLimitStreak(ledger, c.allowance, now), [ledger, c.allowance, now]);

  const catName = useMemo(() => {
    const byId = new Map(ledger.cats.map((k) => [k.id, k[lang]]));
    return (id: string | null) => (id ? (byId.get(id) ?? t('uncategorized')) : t('uncategorized'));
  }, [ledger.cats, lang, t]);

  /**
   * Realistic monthly saving capacity: what the salary cycle leaves after the
   * month's projected spending. Using the month-to-date figure instead would
   * read as near-zero before payday and make every projection nonsense.
   */
  /*
   * The monthly contribution comes from the engine, not from a local estimate.
   * This used to be `livingPool − projectedMonth`, which is a different notion
   * of saving from the one the goal actually receives — so this screen
   * projected a fourth landing figure, disagreeing with Home and with the goal
   * plan. Everything projects from one number now.
   */
  const capacity = c.goalMonthly;

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        contentContainerStyle={{
          padding: SPACE.lg,
          paddingTop: insets.top + SPACE.lg,
          paddingBottom: SPACE.xxl,
        }}
      >
        <Button label={t('back')} variant="secondary" onPress={() => router.back()} />
        <View style={{ height: SPACE.lg }} />
        <Title>{t('insights')}</Title>

        {/* ---- goal projections ---- */}
        {c.goals.filter((g) => g.target).length > 0 && (
          <Card>
            <Title>{t('goalETA')}</Title>
            <Caption>{t('goalETANote')}</Caption>
            <View style={{ marginTop: SPACE.sm }}>
              <Button label={t('goalPlanT')} onPress={() => router.push('/goal-plan')} />
            </View>
            {c.goals
              .filter((g) => g.target)
              .map((g) => {
                const proj = goalProjection(g, capacity, fxRate, now);
                const egp = isEgpGoal(g);
                const fmt = (n: number) => (egp ? formatEgp(n, lang) : money(n));
                const held = egp ? g.alloc * fxRate + (g.extEgp ?? 0) : g.alloc;
                return (
                  <View key={g.id} style={{ marginTop: SPACE.lg }}>
                    <Row label={g[lang]} value={fmt(g.target ?? 0)} />
                    <Meter ratio={g.target ? held / g.target : 0} />
                    <Row label={t('remaining')} value={fmt(proj.remaining)} />
                    <Row
                      label={t('atCurrentPace')}
                      value={
                        proj.monthsAtCurrentPace == null
                          ? t('never')
                          : `${num(Math.ceil(proj.monthsAtCurrentPace))} ${t('monthsW')}`
                      }
                      valueColor={proj.monthsAtCurrentPace == null ? p.negative : p.positive}
                    />
                    {proj.eta && (
                      <Row
                        label={t('eta')}
                        value={`${MONTHS[lang][proj.eta.getMonth()]} ${proj.eta.getFullYear()}`}
                        valueColor={p.accentDeep}
                      />
                    )}
                    {/* A target with no deadline reserves nothing, so it quietly
                        never happens. This is the one warning worth shouting. */}
                    {g.months == null && (
                      <View style={[styles.warn, { backgroundColor: p.accentWash, borderColor: p.warn }]}>
                        <Body style={{ color: p.warn }}>{t('noDeadlineWarn')}</Body>
                        <View style={{ marginTop: SPACE.sm }}>
                          <Button
                            label={t('setDeadline')}
                            variant="secondary"
                            onPress={() => router.push(`/goal-plan?id=${g.id}`)}
                          />
                        </View>
                      </View>
                    )}
                    {proj.behindSchedule && (
                      <Caption style={{ color: p.negative, marginTop: SPACE.sm }}>
                        {t('behindSchedule')}
                      </Caption>
                    )}
                  </View>
                );
              })}
          </Card>
        )}

        {/* ---- this month ---- */}
        <Card>
          <Title>{t('thisMonth')}</Title>
          <Row label={t('perDay')} value={money(burn.perDay)} />
          <Row
            label={t('projectedMonth')}
            value={money(burn.projectedMonth)}
            valueColor={burn.projectedOverrun > 0 ? p.negative : p.positive}
          />
          <Row label={t('livingPool')} value={money(c.livingPool)} />
          <Row
            label={burn.projectedOverrun > 0 ? t('projectedOver') : t('projectedSpare')}
            value={money(Math.abs(burn.projectedOverrun))}
            valueColor={burn.projectedOverrun > 0 ? p.negative : p.positive}
          />
          <Row label={t('activeDays')} value={`${num(burn.activeDays)} / ${num(burn.days)}`} />
          {/*
            Suppressed when last month has too few entries. "Spending down
            94%" against a month nobody recorded is not a finding, it is the
            absence of one — and it reads as the opposite of the truth.
          */}
          {comparison.change != null && ready.monthCompare !== 'insufficient' ? (
            <Row
              label={t('vsLastMonth')}
              value={`${comparison.change > 0 ? '+' : ''}${num(Math.round(comparison.change * 100))}%`}
              valueColor={comparison.change > 0 ? p.negative : p.positive}
            />
          ) : comparison.change != null ? (
            <Caption style={{ color: p.warn, marginTop: SPACE.xs }}>{t('rdLastMonthEmpty')}</Caption>
          ) : null}
          {streak > 0 && (
            <Caption style={{ marginTop: SPACE.sm, color: p.positive }}>
              🔥 {num(streak)} {t('streakDays')}
            </Caption>
          )}
        </Card>

        {/* ---- window selector ---- */}
        <Chips
          value={window}
          onChange={(w) => setWindow(w)}
          options={[
            { id: 30, label: t('last30') },
            { id: 90, label: t('last90') },
            { id: 365, label: t('lastYear') },
          ]}
        />

        {/*
          Stated before any conclusion below it, because the reader needs to
          know how much weight the rest of this screen can carry.
        */}
        <Card>
          <Title>{t('rdT')}</Title>
          <Row
            label={t('rdDensity')
              .replace('{n}', num(ready.recordedDays))
              .replace('{d}', num(ready.totalDays))}
            value={`${num(Math.round(ready.density * 100))}%`}
            valueColor={
              ready.overall === 'good' ? p.positive : ready.overall === 'thin' ? p.warn : p.negative
            }
          />
          <Caption style={{ marginTop: SPACE.xs }}>
            {ready.overall === 'good' ? t('rdGood') : t('rdWhy')}
          </Caption>
        </Card>


        {/* ---- merchants ---- */}
        <Card>
          <Title>{t('topMerchants')}</Title>
          <Caption>{t('topMerchantsNote')}</Caption>
          {ready.merchants === 'insufficient' ? (
            <Body muted style={{ marginTop: SPACE.md }}>{t('rdNone')}</Body>
          ) : merchants.length === 0 ? (
            <Body muted style={{ marginTop: SPACE.md }}>{t('noDataYet')}</Body>
          ) : (
            <View style={{ marginTop: SPACE.md }}>
              {merchants.map((m) => (
                <View key={m.name} style={{ marginBottom: SPACE.md }}>
                  <Row
                    label={`${m.name.trim()} · ${num(m.count)}×`}
                    value={money(m.total)}
                  />
                  <Meter ratio={m.share} />
                  <Caption>
                    {t('avgTicket')} {money(m.average)} · {num(Math.round(m.share * 100))}%
                  </Caption>
                </View>
              ))}
            </View>
          )}
        </Card>

        {/* ---- categories ---- */}
        <Card>
          <Title>{t('byCategory')}</Title>
          {ready.categories === 'thin' && (
            <Caption style={{ color: p.warn }}>{t('rdThin')}</Caption>
          )}
          {cats.length === 0 ? (
            <Body muted style={{ marginTop: SPACE.md }}>{t('noDataYet')}</Body>
          ) : (
            <View style={{ marginTop: SPACE.md }}>
              {cats.map((s) => (
                <View key={s.id ?? 'none'} style={{ marginBottom: SPACE.md }}>
                  <Row
                    label={`${catName(s.id)} · ${num(s.count)}`}
                    value={`${money(s.total)} · ${num(Math.round(s.share * 100))}%`}
                  />
                  <Meter ratio={s.share} />
                </View>
              ))}
            </View>
          )}
        </Card>

        {/* ---- subscriptions ---- */}
        <Card>
          <Title>{t('recurringT')}</Title>
          <Caption>{t('recurringNote')}</Caption>
          {ready.recurring === 'thin' && (
            <Caption style={{ color: p.warn }}>{t('rdThin')}</Caption>
          )}
          {recurring.length === 0 ? (
            <Body muted style={{ marginTop: SPACE.md }}>{t('noRecurring')}</Body>
          ) : (
            <View style={{ marginTop: SPACE.md }}>
              {recurring.map((r) => (
                <Row
                  key={r.name}
                  label={`${r.name.trim()} · ${num(r.occurrences)}×`}
                  value={money(r.amount)}
                  valueColor={p.warn}
                />
              ))}
              <Caption style={{ marginTop: SPACE.sm }}>{t('recurringTip')}</Caption>
            </View>
          )}
        </Card>

        {/* ---- what-if ---- */}
        {merchants.length > 0 && (
          <Card>
            <Title>{t('whatIf')}</Title>
            <Caption>{t('whatIfNote')}</Caption>
            <View style={{ marginTop: SPACE.md }}>
              {[10, 20, 30].map((pct) => {
                const saved = (burn.projectedMonth * pct) / 100;
                const newCapacity = capacity + saved;
                const goal = c.goals.find((g) => g.target);
                const before = goal ? goalProjection(goal, capacity, fxRate, now) : null;
                const after = goal ? goalProjection(goal, newCapacity, fxRate, now) : null;
                const gain =
                  before?.monthsAtCurrentPace != null && after?.monthsAtCurrentPace != null
                    ? Math.ceil(before.monthsAtCurrentPace) - Math.ceil(after.monthsAtCurrentPace)
                    : null;
                return (
                  <Row
                    key={pct}
                    label={`${t('cutSpending')} ${pct}%`}
                    value={
                      gain != null && gain > 0
                        ? `${money(saved)} · ${t('sooner')} ${num(gain)} ${t('monthsW')}`
                        : money(saved)
                    }
                    valueColor={p.positive}
                  />
                );
              })}
            </View>
          </Card>
        )}

        {/* ---- saving ---- */}
        <Card>
          <Title>{t('saved')}</Title>
          <Row label={t('income')} value={money(sv.incomeM)} valueColor={p.positive} />
          <Row label={t('monthSpend')} value={money(sv.spendM)} valueColor={p.negative} />
          <Row
            label={t('saved')}
            value={money(sv.actual)}
            valueColor={sv.actual >= 0 ? p.positive : p.negative}
          />
          <Row label={t('capacity')} value={money(capacity)} valueColor={p.accentDeep} />
          <Caption style={{ marginTop: SPACE.sm }}>{t('capacityNote')}</Caption>
        </Card>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  warn: {
    marginTop: SPACE.md,
    padding: SPACE.md,
    borderRadius: RADIUS.md,
    borderWidth: 1,
  },
});
