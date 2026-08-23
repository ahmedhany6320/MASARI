import { router } from 'expo-router';
import { View } from 'react-native';
import type { CardClaim as Claim } from '../domain';
import { useLocalization, usePalette } from '../store/selectors';
import { SPACE } from '../theme/tokens';
import { Body, Button, Caption, Row, Title } from './ui';

/**
 * The credit card's claim on this month's salary, itemised.
 *
 * This exists because a single "card due" line is not believable: the user can
 * see a four-figure balance in their banking app and a three-figure deduction
 * here, and has no way to tell whether the difference is a bug or a schedule.
 * So the component shows every part, says which bucket each one is counted in,
 * and closes with the identity that proves nothing was lost — charged this
 * month plus deferred equals total owed.
 */
export function CardClaimBreakdown({ claim, compact = false }: { claim: Claim; compact?: boolean }) {
  const { t, money } = useLocalization();
  const p = usePalette();

  if (claim.totalOwed <= 0) return null;

  return (
    <View>
      {!compact && (
        <>
          <Title>{t('cardClaimT')}</Title>
          <Caption>{t('cardAudit')}</Caption>
        </>
      )}

      <View style={{ marginTop: SPACE.sm }}>
        {claim.statement > 0 && (
          <Row label={t('cardStmtRow')} value={`− ${money(claim.statement)}`} valueColor={p.negative} />
        )}
        {claim.installment > 0 && (
          <Row label={t('cardInstRow')} value={`− ${money(claim.installment)}`} valueColor={p.negative} />
        )}
        {claim.carried > 0 && (
          <>
            <Row label={t('cardCarriedRow')} value={`− ${money(claim.carried)}`} valueColor={p.negative} />
            <Caption style={{ marginTop: SPACE.xs }}>{t('cardCarriedNote')}</Caption>
          </>
        )}
        <Row label={t('cardDueLabel')} value={`− ${money(claim.due)}`} valueColor={p.ink} />
      </View>

      {/*
        Deliberately shown as a non-deduction. Leaving it out entirely is what
        makes the numbers look wrong: the spending is real and the user knows
        it, so the honest move is to name it and say where it is counted.
      */}
      {claim.cycleUnbilled > 0 && (
        <View style={{ marginTop: SPACE.md }}>
          <Row label={t('cardCycleRow')} value={money(claim.cycleUnbilled)} valueColor={p.sub} />
          <Caption style={{ marginTop: SPACE.xs }}>{t('cardCycleNote')}</Caption>
        </View>
      )}

      {claim.deferred > 0 && (
        <View style={{ marginTop: SPACE.md }}>
          <Row
            label={t('cardDeferredRow')}
            value={money(claim.deferred)}
            valueColor={claim.installmentUnknown ? p.warn : p.sub}
          />
        </View>
      )}

      {/*
        The audit line. `chargedThisMonth + deferred === totalOwed` is what
        lets someone reconcile this screen against their banking app instead of
        taking the app's word for it.
      */}
      <View style={{ marginTop: SPACE.md }}>
        <Row label={t('cardChargedNow')} value={money(claim.chargedThisMonth)} valueColor={p.ink} />
        <Row label={t('cardTotalOwed')} value={money(claim.totalOwed)} valueColor={p.negative} />
        {claim.deferred === 0 && (
          <Caption style={{ marginTop: SPACE.xs, color: p.positive }}>{t('cardFullyCharged')}</Caption>
        )}
      </View>

      {claim.installmentUnknown && (
        <View
          style={{
            marginTop: SPACE.lg,
            padding: SPACE.md,
            borderRadius: 12,
            backgroundColor: p.faint,
          }}
        >
          <Body style={{ color: p.warn }}>{t('instUnknownT')}</Body>
          <Caption style={{ marginTop: SPACE.xs }}>{t('instUnknownB')}</Caption>
          <View style={{ marginTop: SPACE.md }}>
            <Button label={t('setInstMoBtn')} variant="secondary" onPress={() => router.push('/card')} />
          </View>
        </View>
      )}
    </View>
  );
}
