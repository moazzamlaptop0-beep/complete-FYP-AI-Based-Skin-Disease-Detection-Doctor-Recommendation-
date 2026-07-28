/**
 * ============================================================================
 *  AI DERMATOLOGIST — UI PRIMITIVE BARREL
 * ============================================================================
 *  Import everything from here:
 *
 *     import { Button, Card, Modal, SeverityBadge } from '@/components/ui';
 *     // or, from a page:
 *     import { Button } from '../../components/ui';
 *
 *  Rules for this layer:
 *   - Primitives NEVER import from pages, contexts, or `lib/api.js`. They are
 *     presentational and must stay trivially testable and reusable.
 *   - Every colour comes from the semantic token scales (primary/accent/
 *     success/warning/danger/neutral + canvas/surface/border/text). No raw hex.
 *   - Every interactive primitive is keyboard-operable and carries the ARIA
 *     wiring for its role.
 * ============================================================================
 */

/* ---------------------------------- utils --------------------------------- */
export { cn } from '../../lib/cn';

/* --------------------------------- actions -------------------------------- */
export { Button, focusRing } from './Button';
export { IconButton } from './IconButton';

/* ---------------------------------- forms --------------------------------- */
export { Field, Label, FieldHint, FieldError, useFieldContext, useControlA11y } from './Field';
export { Input, controlBase, controlInvalid, controlSizes } from './Input';
export { Textarea } from './Textarea';
export { Select } from './Select';
export { Checkbox } from './Checkbox';
export { Switch } from './Switch';
export { RadioGroup, Radio } from './RadioGroup';
export { SearchInput } from './SearchInput';
export { LocationSearch } from './LocationSearch';
export { DateRangeFilter, dateInRange, hasDateRange } from './DateRangeFilter';

/* -------------------------------- containers ------------------------------ */
export { Card, CardHeader, CardBody, CardFooter } from './Card';

/* --------------------------------- overlays ------------------------------- */
export {
  Portal,
  Scrim,
  useFocusTrap,
  useScrollLock,
  usePresence,
  useEvent,
} from './Overlay';
export { Modal, ModalHeader, ModalBody, ModalFooter, CloseIcon } from './Modal';
export { Drawer } from './Drawer';
export { ConfirmDialog } from './ConfirmDialog';
export { Tooltip } from './Tooltip';

/* ------------------------------- data display ----------------------------- */
export {
  Badge,
  SeverityBadge,
  StatusBadge,
  RoleBadge,
  SEVERITY_PRESETS,
  STATUS_PRESETS,
  ROLE_PRESETS,
} from './Badge';
export { Avatar, AvatarGroup, initialsFrom } from './Avatar';
export { DataTable } from './DataTable';
export { Pagination, buildPageRange } from './Pagination';

/* -------------------------------- navigation ------------------------------ */
export { Tabs, TabList, TabTrigger, TabPanel } from './Tabs';
export { Stepper } from './Stepper';

/* -------------------------------- feedback -------------------------------- */
export { Alert } from './Alert';
export { Spinner } from './Spinner';
export { Progress, CircularProgress } from './Progress';
export { Skeleton, SkeletonGroup, SkeletonText, SkeletonCard, SkeletonTable } from './Skeleton';
export { EmptyState } from './EmptyState';
export { ToastProvider, notify, toast } from './Toast';
