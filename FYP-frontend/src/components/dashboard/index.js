/**
 * Shared dashboard building blocks: the unified page header, equal-height
 * stat tiles, chart frames and the two chart forms. Every role's overview
 * page is built from exactly these pieces.
 */

export { default as PageHeader } from './PageHeader';
export { default as StatCard } from './StatCard';
export { default as ChartCard } from './ChartCard';
export { ActivityBars, StatusList } from './charts';
export { STATUS_FILLS, bucketByWeek } from './chartData';
