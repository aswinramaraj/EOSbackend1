/**
 * Weekly teaching-hours threshold above which a faculty member is flagged as
 * overloaded. No DB column stores a per-faculty capacity today — this single
 * shared constant is the one place that number lives, so every module
 * (Principal dashboard, Academic Coordinator workload view, ...) agrees on
 * what "overloaded" means.
 */
export const WORKLOAD_THRESHOLD_HOURS = 20;
