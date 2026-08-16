import { formatAmount } from './money';
import type { SafeSpend } from './safeSpend';
import type { Commitment, Lang, Ledger } from './types';

/**
 * Notification message text.
 *
 * Lives in the domain layer, with no dependency on expo-notifications, so the
 * wording and the decision of *whether* a notification is warranted can be
 * unit-tested without a device. `src/lib/notifications.ts` handles delivery.
 */

export interface NotificationContent {
  title: string;
  body: string;
}

function money(n: number, lang: Lang): string {
  return `${formatAmount(n)} ${lang === 'ar' ? 'د.إ' : 'AED'}`;
}

/**
 * The morning brief: what is safe to spend today.
 *
 * Deliberately leads with the number rather than a greeting — this is read on
 * a lock screen, where only the first few words survive truncation.
 */
export function morningBrief(c: SafeSpend, lang: Lang): NotificationContent {
  if (lang === 'ar') {
    if (c.ssl <= 0) {
      return {
        title: 'مصاري',
        body: `مفيش حد آمن النهارده. فاضل ${c.daysLeft} يوم على الراتب.`,
      };
    }
    return {
      title: `النهارده: ${money(c.ssl, lang)}`,
      body: `ده اللي تقدر تصرفه من غير ما تتأخر عن أهدافك. فاضل ${c.daysLeft} يوم على الراتب.`,
    };
  }
  if (c.ssl <= 0) {
    return {
      title: 'Masari',
      body: `Nothing safe to spend today. ${c.daysLeft} days until payday.`,
    };
  }
  return {
    title: `Today: ${money(c.ssl, lang)}`,
    body: `That is what you can spend without falling behind. ${c.daysLeft} days until payday.`,
  };
}

/**
 * Evening check-in, sent only when the day has gone over. A notification that
 * fires every evening to say "all fine" trains people to ignore it, so silence
 * is the default and the alert means something.
 */
export function overspendAlert(c: SafeSpend, lang: Lang): NotificationContent | null {
  if (c.overToday <= 0) return null;
  if (lang === 'ar') {
    return {
      title: 'تجاوزت حد النهارده',
      body: `صرفت ${money(c.overToday, lang)} زيادة. حد بكرة هيبقى ${money(c.tomorrow, lang)}.`,
    };
  }
  return {
    title: "You went over today's limit",
    body: `${money(c.overToday, lang)} over. Tomorrow's limit will be ${money(c.tomorrow, lang)}.`,
  };
}

/**
 * Warning as the day's allowance runs low. Fires once, at the threshold, not
 * on every purchase after it.
 */
export function nearLimitAlert(c: SafeSpend, lang: Lang, threshold = 0.8): NotificationContent | null {
  if (c.allowance <= 0) return null;
  const used = c.flexToday / c.allowance;
  if (used < threshold || used >= 1) return null;
  if (lang === 'ar') {
    return {
      title: 'قربت على حد النهارده',
      body: `فاضلك ${money(c.ssl, lang)} بس النهارده.`,
    };
  }
  return {
    title: "You're close to today's limit",
    body: `${money(c.ssl, lang)} left for today.`,
  };
}

/**
 * Commitments falling due within `withinDays`.
 *
 * Paused and already-paid commitments are excluded — reminding someone about a
 * bill they have already settled is how an app loses trust.
 */
export function dueCommitments(
  ledger: Pick<Ledger, 'commits'>,
  now: Date,
  withinDays = 3,
): Commitment[] {
  const today = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return ledger.commits.filter((k) => {
    if (k.paused || k.paidMonth || !k.day || !k.amt) return false;
    // Wraps across the month boundary, so a bill due on the 2nd still warns
    // from the 30th.
    const delta = (k.day - today + daysInMonth) % daysInMonth;
    return delta <= withinDays;
  });
}

export function commitmentReminder(
  commits: Commitment[],
  lang: Lang,
): NotificationContent | null {
  if (commits.length === 0) return null;
  const total = commits.reduce((a, k) => a + (k.amt ?? 0), 0);
  const names = commits.map((k) => k[lang]).join('، ');
  if (lang === 'ar') {
    return {
      title: commits.length === 1 ? 'التزام قرّب' : 'التزامات قرّبت',
      body: `${names} — ${money(total, lang)}`,
    };
  }
  return {
    title: commits.length === 1 ? 'A commitment is due' : 'Commitments are due',
    body: `${commits.map((k) => k.en).join(', ')} — ${money(total, lang)}`,
  };
}
