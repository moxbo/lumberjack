# Changelog

Alle nennenswerten Änderungen an diesem Projekt werden in dieser Datei dokumentiert.

Das Format orientiert sich an [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
und dieses Projekt folgt [Semantic Versioning](https://semver.org/lang/de/).

## [1.1.0] - 2026-06-18


### Added
- **filters**: Optimize message filtering with precompiled patterns for improved performance
- **vite.config**: Disable modulePreload for optimized initial load and adjust chunking strategy
- **parsers**: Add asynchronous parsing functions for paths and enhance error handling
- Add timestamp field support for Elasticsearch filtering and sorting
- Implement batched emission for large initial content in HttpTailManager
- Enhance release notes rendering with HTML sanitization and Markdown support
- Enhance CHANGELOG generation for stable releases by aggregating pre-release tags


### Changed
- **dcFilter**: Extract shared DC filter logic into utility module


### Docs
- Update release process in CONTRIBUTING.md and add release script [skip-ci]


### Fixed
- **vite.config**: Remove unnecessary chunking rule for utils to improve tree-shaking
- **electron-install**: Add script to fix common Electron installation issues on Node 24/macOS
- Highlight all matches for OR (|) full-text search
- **NetworkService**: Improve TCP line processing and handle trailing data without newline
- **parsers**: Enhance timestamp handling for Elasticsearch/OpenSearch documents
- **filterWorker**: Implement stateful caching for log filtering to improve performance
- **enqueueAppends**: Improve handling of bulk appends and enforce buffer limits
- **release**: Correct variable interpolation in version bump message
- **release**: Update commit message filtering to exclude release-related chores
- Improve byte offset tracking for multi-byte UTF-8 content in HttpTailManager
- Remove unnecessary libc entries from package-lock.json
- Implement boolean query syntax for message filtering in Elasticsearch
- Enhance elastic entry loading logic and improve loaded count tracking


### Tests
- **measure-sync-io**: Add benchmarking tool for synchronous vs asynchronous file operations
- **measure-sync-io**: Enhance benchmarking with strict mode and failure reporting

## [1.0.15] - 2026-05-22


### Added
- Add filter update functionality with confirmation prompts and success messages
- Implement internationalization for various UI components
- Enhance filter profiles with search mode and undo functionality
- Add profile search functionality and tooltips for actions
- Enhance accessibility by adding support for prefers-reduced-motion and improving status roles
- Add bookmarks popover and non-blocking toast notifications for user feedback
- Update translations for common actions and enhance export messages
- Implement alert rules management with evaluation and notifications
- Implement file watcher for tailing log files with rotation and error handling
- Add incremental HTTP tailing support for Range-based polling
- Add platform-specific taskbar menus for quick window opening
- Intercept page title updates to manage dynamic suffixes
- Enhance error handling with cause property in various modules
- Add HTTP tail stop functionality and update menu integration
- Add release commands for macOS and Windows in package.json and update GitHub Actions workflow
- Add HTTP tail count display in status indicators and translations
- Add aggregated aria-live announcements for incoming logs and enhance accessibility
- Implement in-app confirm dialog to replace native window.confirm for improved focus handling
- Add manual update check feature in settings with status feedback
- **export**: Enhance export functionality to support structured formats with correct mark colors


### Changed
- Update color scheme for improved contrast and readability
- Adjust filter input widths and layout for improved responsiveness
- Remove focus outline from list elements for improved accessibility
- Improve dropdown positioning and styling for better visibility and usability
- Enhance CI configuration to include test coverage and support macOS
- Implement placeholder menu during app bootstrapping and install real menu on settings load
- Calculate min/max timestamps for all entries to improve quick-select functionality in Elastic-Search-Dialog
- Convert LoggingStore to a pure event-bus and update event counting logic
- Enhance empty state messages for TCP server status and actions


### Docs
- Update deployment and security guidelines for code signing and notarization
- Add HTTP and file tailing features to README [skip-ci]
- Update CHANGELOG


### Fixed
- Enhance portable mode detection for auto-updater service
- Enhance profile import functionality with improved data normalization and error handling
- Refine dialog filtering logic in Vite configuration
- Add initialization promise and waitForInit method for filter profiles store
- Add up and down arrow icons to navigation buttons in toolbar
- Enhance focus management for native dialogs and improve keyboard input restoration
- Update font-family variables in styles and improve toast import path
- Enhance empty state UI with additional actions and icons for better user interaction
- Update search URLs to include document IDs and indices for improved data retrieval
- Adjust CSS selector for dark mode to improve styling of modal settings and warnings
- Adjust settings navigation styles for improved layout and icon sizing
- Add development CSP plugin to allow inline styles during Vite development
- Expose setTcpOwnerWindowId method in shared API for improved window management
- Refactor CI/CD workflows for improved organization and clarity
- Update build workflow to restrict execution to version tags and manual triggers
- Update Qodana workflow to support multiple branches and upgrade action version
- Standardize quotes in Qodana workflow configuration
- Enforce Node.js 24 for JavaScript actions in CI/CD workflows
- Update Electron version in README and enhance features listc [skip-ci]
- Enhance version comparison logic to support semantic versioning with prereleases
- Implement Markdown rendering for update release notes
- Safely dispose AutoUpdaterService if instantiated and handle errors
- Update CSS variable for settings update availability color
- **export**: NDJSON/CSV/MD save real content + restore mark colors on import
- **export**: Remove hardcoded HTML extension from default filename to prevent format mismatch
- **export**: Set NDJSON as default format and update save dialog filters
- **import**: Add NDJSON support to file filters in IPC handlers and parsers
- **LogRow**: Adjust background color handling for selected rows
- **filters**: Ensure only active MDC entries are persisted in profiles


### Performance
- Silence hot-path diagnostic logs in production


### Tests
- **perf**: Extend baseline benchmark with filter, IPC payload and heap

## [1.0.14] - 2026-04-01


### Added
- Enhance search functionality with phrase support and improved syntax instructions
- Update search functionality with improved placeholder text and help documentation
- Enhance styles for dark mode support and improve select dropdown appearance
- Add cross-window localStorage change listener for profile synchronization
- Add new components for status indicators and toolbar navigation
- Add profile renaming, exporting, and importing functionalities
- Implement portable update checks and GitHub releases integration


### Changed
- Streamline HTTP response decompression logic to prevent double-decompression errors
- Increase default keepAlive duration and batch size for Elasticsearch queries
- Update CI configuration for improved linting and testing workflow
- Ensure newline at end of file in CI configuration
- Simplify selection movement logic in App.tsx
- Replace native dialog calls with focus-safe wrappers in App and dialog components
- Simplify entry management logic and enhance elastic search handling
- Replace console.log with console.warn for improved logging consistency
- Replace console.log with logger methods for improved logging consistency
- Streamline trace key normalization and entry data application logic
- Simplify boolean checks and remove unused export functions


### Fixed
- Improve focus handling for keyboard input in Electron app
- Add null checks for data and entry in LogEntryPool to prevent runtime errors


### Tests
- Add unit tests for AdaptiveBatchService, CircuitBreaker, FeatureFlags, and RateLimiter

## [1.0.13] - 2026-02-16


### Added
- Implement window focus handling to resolve input issues when switching between windows
- Add splash screen with transition effects for improved user experience
- Implement UtilityProcess for efficient filtering of large datasets
- Enhance DC filter logic to support combined OR/AND matching for multiple keys and values
- Implement slim entry projection to prevent DataCloneError during IPC transfers
- Implement error boundary with memory error handling and user recommendations

## [1.0.12] - 2026-01-30


### Added
- Enhance DC filter functionality with state retrieval and synchronous filtering support
- Optimize performance for large datasets with caching and dynamic configurations


### Changed
- Rename msgMatches import for clarity and improve error handling in filter logic
- Improve socket error logging by removing UI log entry for internal errors


### Fixed
- Clear HTTP status on successful API response


### Tests
- Add end-to-end tests for DC filter functionality and logic

## [1.0.11] - 2026-01-23


### Added
- Implement advanced message filtering with logical operators and escape support


### Fixed
- Ensure webContents receives focus for keyboard input in multiple scenarios
- Remove unused isFiltering variable from filter worker integration


### Tests
- Add end-to-end tests for multi-instance input behavior
- Update accessibility language check to support locale-based languages

## [1.0.10] - 2026-01-21


### Added
- Implement LogEntryPool for efficient memory management of log entries
- Add Command Palette for quick access to app functions via keyboard shortcuts
- Implement filter profiles management with saving, loading, and deleting capabilities Moritz Bohm 2 minutes ago
- Update default UI language from German to English
- Add TraceTimeline component for visualizing request flow by TraceID
- Integrate useFilterWorker for optimized filtering of large datasets


### Changed
- Reactivate existing filter entries in dcFilter if deactivated


### Docs
- Translate CONTRIBUTING.md and README.md to English for wider accessibility


### Fixed
- Update unit test command in package.json and refine vitest configuration


### Tests
- Add unit testing and coverage configuration with Vitest
- Enhance CI configuration for Electron testing and increase timeouts
- Update accessibility language check from 'de' to 'en' in smoke.spec.ts

## [1.0.9] - 2026-01-15


### Added
- Add skeleton loader styles for improved UI loading experience
- Optimize Windows portable build for faster startup and improved user experience
- Add support for allowing insecure SSL certificates in HTTP requests


### Changed
- Format CSS for improved readability and consistency

## [1.0.8] - 2026-01-15


### Added
- Implement lazy loading for dialogs and add skeleton loader for improved startup experience
- Optimize settings fetching during preload to reduce IPC round-trips


### Changed
- Implement lazy initialization and memory optimizations for auto-updater service
- Improve type safety and centralize settings loading in the application
- Streamline entry management by renaming and consolidating hooks


### Docs
- Update license badge in README from ISC to MIT


### Fixed
- Implement auto-update availability check and enhance logging for update process

## [1.0.7] - 2026-01-02


### Added
- Add speech menu option and settings access for macOS


### Docs
- Update installation instructions and troubleshooting for macOS security warnings


### Fixed
- Correct app path for macOS DMG and ZIP build in CI workflow

## [1.0.6] - 2026-01-02


### Added
- Implement automatic version retrieval from Git tags and environment variable in release workflow


### Changed
- Enhance memory monitoring logic with improved thresholds and conditions
- Extract hooks for alert management and history popovers from App.tsx
- Add CI job for running tests and lint checks on all pushes


### Fixed
- Add peer dependencies to various packages in package-lock.json
- Update GitHub repository link in README.md


### Deps
- Update @typescript-eslint and related packages to latest versions

## [1.0.5] - 2025-12-27


### Build
- Remove unnecessary blank line in build.yml
- Update macOS version in build.yml for x64 architecture
- Remove x64 architecture support from macOS targets in build.yml and package.json


### Changed
- Add getDefaultLogPath API for retrieving default log file path


### Fixed
- Add ZIP to macOS build for auto-updater support
- Add x64 architecture support for dmg and zip targets in package.json


### Deps
- Update @typescript-eslint packages and preact to latest versions

## [1.0.4] - 2025-12-26


### Added
- Disable code signing verification for unsigned builds on macOS and update version to 1.0.4

## [1.0.3] - 2025-12-26


### Added
- Update mac build configuration to support arm64 architecture


### Changed
- Conditionally include dev tools menu options in production
- Add icon support for About dialog on macOS


### Docs
- Update README with JSON logging configuration for Lumberjack
- Update TCP port configuration for Lumberjack in README

## [1.0.2] - 2025-12-25


### Added
- Add support for creating fast portable ZIP for Windows builds
- Add additional tests and clean up temporary files in smoke-parse
- Add browser console debug script for interactive checks


### Changed
- Enhance filter history management and improve autocomplete behavior


### Docs
- Add screenshots and logging configuration examples


### Fixed
- Enable rendering of release notes as HTML in update notifications


### Performance
- Optimize startup time by deferring initialization of services and reducing synchronous operations

## [1.0.1] - 2025-12-24


### Changed
- Clean up whitespace in build.yml for improved readability
- Improve update download experience with status indication and button state management


### Fixed
- Enhance search functionality with keyboard navigation and history selection

## [1.0.0] - 2025-12-24


### Added
- Implement diagnostic context filtering and enhance log entry management
- Add Prettier configuration and ignore files for consistent code formatting
- Implement file logging functionality with configuration options
- Enhance file handling and UI with theme support and new input styles
- Implement MDC filter modal and enhance details overlay with tinting support
- Enhance diagnostic context filtering and improve MDC entry management
- Add follow mode with smooth scrolling for last selected entry
- Enhance log handling with stack trace normalization and buffering
- Implement sorting utility for log entries by timestamp and ID
- Add Diagnostic Context Filter dialog and enhance filtering capabilities
- Add macOS icon generation support and enhance icon build scripts
- Enhance test script to include message filter and MDC flow verification
- Dynamically read divider height from CSS variable and enhance settings modal layout
- Enhance styles for overlay and divider with improved blur and scrollbar support
- Add keyboard navigation and improved scroll handling for log list
- Add lazy singleton instantiation to prevent circular import issues and enhance diagnostics
- Add environment-aware logger and electron-log integration
- Update vite to version 7.1.12 for improved performance and features
- Add TypeScript definitions for adm-zip and improve module loading
- Implement window title management and IPC handlers for dynamic title updates
- Add About and Help dialogs with detailed application information
- Add ElasticSearch histories for application name and environment in settings
- Add ElasticSearch histories for application name and environment in settings
- Enhance ElasticSearch dialog with new fields and improved logging
- Add color marking feature with customizable palette and persistence
- Implement pagination for Elasticsearch queries with search_after support
- Add pagination support for Elasticsearch logs with enhanced entry normalization
- Add support for Elasticsearch PIT (Point In Time) session management and improve deduplication logic
- Enhance Elasticsearch dialog with index history and environment case handling
- Implement keyboard navigation for entry selection in the list
- Implement transient filter history with popover support for search, logger, thread, and message filters
- Add per-window TCP control permissions and update IPC handlers
- Add x64 build script for Windows using electron-builder
- Add x64 build script for Windows using electron-builder
- Add About and Help dialogs with system information and usage instructions
- Add confirmation dialogs for clearing logs and quitting the application
- Add Copilot Agent guide for project workflow and best practices
- Implement i18n support for settings and update language selection
- Add gzip, deflate, and brotli decompression support for HTTP responses
- Add support for gzip, deflate, and brotli decompression in HTTP response handling
- Implement batch processing for log entries with truncation
- Update default load mode to 'append' in ElasticSearchDialog and enhance time filtering for Elastic sources
- Implement MDC key picker modal and enhance event handling in DCFilterDialog and DCFilterPanel
- Add CHANGELOG, deployment guide, and implementation report for icon and freeze fixes; enhance diagnostics and error handling
- Enhance icon resolution logic for macOS and Windows; improve logging and add PNG fallback for ICNS generation
- Add comprehensive performance and stability documentation for Lumberjack; include quick start optimizations, implementation roadmap, and troubleshooting guide
- Implement prepack script to prepare release metadata; streamline package.json for electron-builder
- Add GitHub Actions workflow for building and releasing Electron app
- Enhance GitHub Actions workflow for flexible release management and improve IPC API structure
- Enable multi-instance support by spawning new processes for additional windows
- Implement useDebounce hook for improved performance in filtering and searching
- Refactor and modularize main application logic, enhance security, and improve message handling
- Implement startup optimizations for improved performance and user experience on Windows
- Enhance empty state messaging and improve UI for log and detail views
- Remove redundant IPC handler registration during window creation
- Implement memory management for log entries and enhance error handling in renderer process
- Add localization for toolbar and details messages
- Enhance memory management and logging stability with new IPC processing
- Enhance UI with collapsible sections, improved empty states, and quick-add feature for Elasticsearch dialog
- Implement afterPack hook to set Windows executable metadata for Lumberjack
- Implement TCP and HTTP batching for improved log throughput
- Optimize message filtering logic with early exits and improved token skipping
- Streamline follow mode functionality and enhance UI for navigation and filtering
- Add advanced message filtering with syntax support in Elasticsearch dialog
- Add re-exports for constants, components, and hooks in index.ts
- Enhance Elasticsearch result loading with improved session management and UI updates
- Enhance Elasticsearch entry handling with improved deduplication and pagination logic
- Refactor filter section into a separate component for improved readability and maintainability
- Add Qodana configuration files for code quality analysis
- Enhance release process with automated changelog generation
- Enhance GitHub release process with draft creation and asset uploads
- Enhance GitHub release process with draft creation and asset uploads
- Improve release workflow by handling tag creation and branch fallback
- Add support for promoting pre-releases to releases in the workflow
- Add comprehensive documentation for Windows taskbar icon fix and update related files
- Implement i18n support for main process and enhance translation functionality
- Add feature flags management panel and related functionality
- Implement feature flags management with persistence and UI updates
- Add AlertDialog component for user notifications and error handling
- Enhance feature flags management with loading state and event synchronization
- Implement HTTP poller stop functionality with abort and cleanup
- Enhance HTTP polling functionality with detailed logging and null checks
- Add locale file copying functionality for release preparation
- Redesign SettingsModal with modern UI and improved layout
- Optimize Windows Portable startup performance with V8 caching and delayed initialization
- Enhance release workflow with architecture-specific builds and artifact organization
- Update HTTP polling interval from milliseconds to seconds for improved clarity
- Add CI step to run tests and generate third-party licenses report
- Implement auto-update functionality with pre-release option
- Add privacy policy documentation in German and English
- Optimize Windows startup performance with additional command line switches
- Add export functionality for current view as HTML, TXT, or JSON
- Add filter buttons for logger and thread in DetailPanel
- Add support for private GitHub repository access in auto-updater
- Configure auto-updater to use GitHub API for private repository access
- Implement filtering behavior to maintain visibility of selected items in list
- Add update notification component for managing app updates
- Add global debug functions and enhance message handling for large entries
- Add performance settings for configurable heap size and memory management
- Add performance settings for configurable heap size and memory management
- Add notarization support for macOS builds with afterSign hook
- Implement retry logic for npm dependency installation in CI workflow


### CI
- Restrict build matrix to windows-latest for streamlined CI process
- Enhance build process with detailed steps for Windows application packaging


### Changed
- Remove unused filter buttons from App component
- Improve code readability and formatting across multiple files
- Reorganize file structure and update import paths for consistency
- Simplify state management and improve type safety in App component
- Clean up whitespace and formatting in multiple files
- Enhance type safety and improve error handling in App component and related modules
- Improve DiagnosticContextFilter handling and streamline state updates
- Simplify Elastic status label in App component
- Clean up code formatting and improve readability in App component
- Improve code formatting and readability across multiple files
- Improve code formatting and readability in multiple files
- Disable text selection in the list for better user experience
- Update comments for clarity and consistency; remove unused MDC-related code
- Simplify event handling and improve code consistency across multiple files
- Update comments for clarity and consistency; remove unused MDC-related code
- Standardize string quotes and improve code formatting across multiple files
- Standardize quotation marks to double quotes across the codebase
- Improve code formatting and update confirmation messages for log clearing
- Update prettierignore to exclude markdown files and improve code formatting
- Update styling and remove unused datalist elements in ElasticSearchDialog
- Improve code formatting and add consistent class names for counts in toolbar
- Improve code formatting and consistency across multiple files
- Improve code formatting and consistency in memory diagnostics and error boundary files
- Improve type safety and consistency across multiple files; replace 'any' with specific types and enhance event handling
- Rename documentation files for improved organization and clarity
- Improve code formatting and consistency across multiple files
- Improve log entry rendering and enhance CSS styles for better layout
- Update log file level to only capture info and above in production
- Clean up code formatting and remove unnecessary whitespace
- Update button icons for navigation in toolbar
- Simplify logger name rendering in LogRow component
- Optimize component initialization tracking and improve HMR configuration
- Enhance performance and stability of virtualizer and i18n context
- Remove redundant reset call in TimeFilter handling
- Improve code formatting and readability in App.tsx and styles.css
- Simplify scrollToIndexCenter function for improved performance and readability
- Prevent resetting HTTP/TCP status when connections are active
- Enhance ElasticSearch dialog styling for improved usability
- Add TypeScript return types to functions for improved type safety
- Enhance IPC handlers for asynchronous settings saving and UI responsiveness
- Exclude session-only marksMap from persisted settings
- Update package-lock.json to correct peer dependency entries


### Final
- Add implementation complete summary and verification
- Update documentation to reflect 100% feature completion
- Add implementation complete summary and verification
- Update documentation to reflect 100% feature completion


### Fix
- Correct icon path in electron-builder configuration


### Fixed
- Measure native scrollbar width and adjust overlay layout accordingly
- Downgrade vite to version 7.1.11 to address compatibility issues
- Improve error handling for settings persistence in App component
- Correct Windows taskbar icon display by setting AppUserModelId and updating icon paths
- Correct Windows taskbar icon display by setting AppUserModelId and updating icon paths
- Restore interactivity in log list by addressing CSS pointer-events and enhancing event handlers
- Resolve Windows icon loading issue by regenerating icon file and adding validation functions
- Add periodic flush timer to ensure TCP logs display in UI
- Remove invalid dependency entry from package.json
- Update version number in package.json to reflect pre-release status
- Update Node.js version in GitHub Actions workflow to 22
- Improve error handling and streamline session dialect assignment in parsers.cjs
- Update Qodana action version to v2025.2 for compatibility
- Downgrade version from 1.0.2 to 1.0.0 in package.json
- Enhance build process by organizing architecture-specific files and copying latest.yml for x64 builds
- Update lastActivityTime to prevent infinite accumulation of frozenMs


### Performance
- Reduce batch sizes and optimize processing to prevent UI freezes during HTTP polling


### Deps
- Update development dependencies and improve dev script
- Update electron-builder to 26.1.0 and add esbuild as a dev dependency
- Update electron-builder to version 26.3.6 and adjust peer dependencies


