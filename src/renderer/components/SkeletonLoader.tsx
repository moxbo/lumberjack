/**
 * SkeletonLoader - Shows a loading skeleton while the app initializes
 * Provides immediate visual feedback for faster perceived startup time
 */

import { JSX } from "preact/jsx-runtime";

/**
 * Skeleton loading indicator that mimics the main app layout
 */
export function SkeletonLoader(): JSX.Element {
  return (
    <div className="skeleton-loader">
      {/* Header skeleton */}
      <div className="skeleton-header">
        <div className="skeleton-bar skeleton-title" />
        <div className="skeleton-toolbar">
          <div className="skeleton-bar skeleton-btn" />
          <div className="skeleton-bar skeleton-btn" />
          <div className="skeleton-bar skeleton-btn" />
        </div>
      </div>

      {/* Filter section skeleton */}
      <div className="skeleton-filters">
        <div className="skeleton-bar skeleton-search" />
        <div className="skeleton-bar skeleton-filter" />
        <div className="skeleton-bar skeleton-filter" />
      </div>

      {/* Log list skeleton */}
      <div className="skeleton-list">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="skeleton-row">
            <div className="skeleton-bar skeleton-ts" />
            <div className="skeleton-bar skeleton-lvl" />
            <div className="skeleton-bar skeleton-logger" />
            <div className="skeleton-bar skeleton-msg" />
          </div>
        ))}
      </div>

      {/* Pulsing animation overlay */}
      <div className="skeleton-pulse" />
    </div>
  );
}
