/**
 * DoctorRatingsPage — GET /api/doctor/ratings.
 *
 * CONTRACT NOTE (#37 vs #38)
 * --------------------------
 * There are two rating endpoints returning the SAME review list under DIFFERENT
 * wrapper keys: the self route (`/api/doctor/ratings`, id from the JWT) uses
 * `average` / `total`, the public one (`/doctor/ratings/<id>`) uses
 * `average_rating` / `rating_count`. The contract says explicitly: do not unify
 * them. So this page reads the self route and tolerates both key sets, which
 * costs one `??` and removes a whole class of "why is my average 0" bug.
 *
 * `average` is 0.0 (never null) when there are no ratings at all — that is why
 * "no ratings yet" is decided by `reviews.length`, not by the average.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { MessageSquareQuote, RefreshCw, Star } from 'lucide-react';

import {
  Alert,
  Avatar,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Select,
  SkeletonGroup,
  Skeleton,
} from '../../components/ui';
import { get } from '../../lib/api';
import { ratings as ratingEndpoints } from '../../lib/endpoints';
import { formatDate, formatNumber } from '../../lib/format';
import { useRealtimeSubscription } from '../../context/RealtimeContext';
import PageHeader from './components/PageHeader';
import useDoctorQuery from './hooks/useDoctorQuery';

/** Five stars, filled to `value`. Decorative — the number next to it is the text. */
function Stars({ value, size = 'md' }) {
  const filled = Math.round(Number(value) || 0);
  const cls = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4';
  return (
    <span className="inline-flex items-center gap-0.5" aria-hidden="true">
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          className={`${cls} ${star <= filled ? 'fill-warning-400 text-warning-500' : 'text-neutral-300 dark:text-neutral-600'}`}
        />
      ))}
    </span>
  );
}

const SORTS = [
  { value: 'recent', label: 'Most recent' },
  { value: 'highest', label: 'Highest rated' },
  { value: 'lowest', label: 'Lowest rated' },
];

export default function DoctorRatingsPage() {
  const [sort, setSort] = useState('recent');

  const fetcher = useCallback((signal) => get(ratingEndpoints.mine(), { signal }), []);
  const { data, error, loading, refreshing, refresh } = useDoctorQuery(fetcher);

  // A new rating arrives on the doctor SSE stream; re-fetch quietly.
  // The stream payload has no `type`/`event` field to filter on (it is
  // `{scans, appointments, ...counts}` — see RealtimeContext's wire format), so
  // the old `kind` regex never matched and this never fired. A payload is only
  // pushed when something CHANGED, so reacting to the scan list is enough.
  useRealtimeSubscription(useCallback((payload) => {
    if (Array.isArray(payload?.scans)) refresh();
  }, [refresh]));

  const average = Number(data?.average ?? data?.average_rating ?? 0);
  const total = Number(data?.total ?? data?.rating_count ?? 0);
  const reviews = useMemo(
    () => (Array.isArray(data?.reviews) ? data.reviews : []),
    [data],
  );

  /** Count per star, so the doctor sees the SHAPE of their feedback, not one number. */
  const histogram = useMemo(() => {
    const buckets = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    reviews.forEach((review) => {
      const value = Math.round(Number(review?.rating) || 0);
      if (buckets[value] !== undefined) buckets[value] += 1;
    });
    return buckets;
  }, [reviews]);

  const sorted = useMemo(() => {
    const list = [...reviews];
    if (sort === 'highest') return list.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    if (sort === 'lowest') return list.sort((a, b) => (a.rating || 0) - (b.rating || 0));
    // `date` is a pre-formatted "Jul 25, 2026" string, so fall back to id order
    // (descending) which is genuinely chronological.
    return list.sort((a, b) => (b.id || 0) - (a.id || 0));
  }, [reviews, sort]);

  const withText = reviews.filter((review) => String(review?.review || '').trim()).length;

  return (
    <>
      <PageHeader
        title="Ratings & reviews"
        description="What your patients said after their consultation."
        actions={
          <Button
            variant="outline"
            leftIcon={<RefreshCw aria-hidden="true" />}
            loading={refreshing}
            onClick={() => refresh()}
          >
            Refresh
          </Button>
        }
      />

      {error && (
        <Alert
          tone="danger"
          title="Could not load your ratings"
          className="mb-6"
          actions={<Button size="sm" variant="outline" onClick={() => refresh()}>Try again</Button>}
        >
          {error.message || 'The ratings service did not answer.'}
        </Alert>
      )}

      {loading ? (
        <SkeletonGroup label="Loading ratings">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <Skeleton shape="card" height={220} />
            <div className="space-y-3">
              <Skeleton shape="card" height={104} />
              <Skeleton shape="card" height={104} />
              <Skeleton shape="card" height={104} />
            </div>
          </div>
        </SkeletonGroup>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          {/* ---------------------------------------------------- summary -- */}
          <Card className="lg:sticky lg:top-20 lg:self-start">
            <CardBody className="space-y-5">
              <div className="text-center">
                <p className="font-numeric text-display-lg text-default">
                  {total ? average.toFixed(1) : '—'}
                </p>
                <Stars value={average} />
                <p className="mt-1 text-body-sm text-muted">
                  {total
                    ? `${formatNumber(total)} rating${total === 1 ? '' : 's'}`
                    : 'No ratings yet'}
                </p>
              </div>

              <div className="space-y-1.5">
                {[5, 4, 3, 2, 1].map((star) => {
                  const count = histogram[star];
                  const percent = reviews.length ? Math.round((count / reviews.length) * 100) : 0;
                  return (
                    <div key={star} className="flex items-center gap-2">
                      <span className="w-8 shrink-0 text-caption text-muted">{star}★</span>
                      <span
                        className="h-2 min-w-0 flex-1 overflow-hidden rounded-pill bg-surface-sunken"
                        role="img"
                        aria-label={`${star} stars: ${count} of ${reviews.length}`}
                      >
                        <span
                          className="block h-full rounded-pill bg-warning-400"
                          style={{ width: `${percent}%` }}
                        />
                      </span>
                      <span className="w-8 shrink-0 text-right font-numeric text-caption text-muted">
                        {count}
                      </span>
                    </div>
                  );
                })}
              </div>

              <p className="border-t border-subtle pt-4 text-caption text-muted">
                {withText
                  ? `${withText} of ${reviews.length} patients left written feedback.`
                  : 'Written feedback appears here as patients add it.'}
              </p>
            </CardBody>
          </Card>

          {/* ---------------------------------------------------- reviews -- */}
          <section aria-label="Patient reviews">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-heading text-heading-md text-default">
                Reviews {reviews.length ? `(${reviews.length})` : ''}
              </h2>
              {reviews.length > 1 && (
                <label className="flex items-center gap-2 text-caption text-muted">
                  <span className="whitespace-nowrap">Sort by</span>
                  <Select
                    size="sm"
                    options={SORTS}
                    value={sort}
                    onChange={(event) => setSort(event.target.value)}
                    aria-label="Sort reviews"
                  />
                </label>
              )}
            </div>

            {!reviews.length ? (
              <EmptyState
                bordered
                icon={<MessageSquareQuote aria-hidden="true" />}
                title="No ratings yet"
                description="Patients can rate you once a consultation is complete. Their score and any written note will show up here."
              />
            ) : (
              <ul className="space-y-3">
                {sorted.map((review, index) => (
                  <li key={review.id ?? `${review.patient_name}-${index}`}>
                    <Card padding="none">
                      <CardHeader
                        className="gap-3"
                        title={(
                          <span className="flex flex-wrap items-center gap-2">
                            <Avatar size="sm" name={review.patient_name || 'Verified Patient'} />
                            <span className="text-label-lg text-default">
                              {review.patient_name || 'Verified Patient'}
                            </span>
                          </span>
                        )}
                        actions={(
                          <span className="flex items-center gap-2">
                            <Stars value={review.rating} size="sm" />
                            <span className="font-numeric text-label-md text-default">
                              {Number(review.rating || 0).toFixed(0)}/5
                            </span>
                          </span>
                        )}
                      />
                      <CardBody className="pt-0">
                        {String(review.review || '').trim() ? (
                          <p className="text-body-sm text-default">{review.review}</p>
                        ) : (
                          <p className="text-body-sm italic text-subtle">
                            Rated without a written review.
                          </p>
                        )}
                        <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-caption text-muted">
                          <span>{review.date || formatDate(review.created_at)}</span>
                          {review.scan_id && <span>Scan #{review.scan_id}</span>}
                          {review.appointment_id && <span>Appointment #{review.appointment_id}</span>}
                        </p>
                      </CardBody>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </>
  );
}
