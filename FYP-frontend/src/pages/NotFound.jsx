import React from 'react';
import { Link } from 'react-router-dom';
import { Home, ScanLine } from 'lucide-react';

import { Button } from '../components/ui';
import { PATHS } from '../routes';

const NotFound = () => {
  return (
    <div className="relative flex min-h-[70vh] flex-col items-center justify-center overflow-hidden bg-canvas px-4 py-20 text-center sm:px-6">
      {/* Soft decorative glow behind the numeral */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/3 h-56 w-56 -translate-x-1/2 -translate-y-1/2 rounded-pill bg-accent-400/15 blur-3xl"
      />

      <p
        aria-hidden="true"
        className="bg-gradient-to-r from-primary-600 to-accent-600 bg-clip-text font-heading text-[6rem] font-bold leading-none tracking-tight text-transparent dark:from-primary-600 dark:to-accent-500 sm:text-[8rem]"
      >
        404
      </p>

      <h1 className="mt-2 font-heading text-display-sm text-default sm:text-display-md">
        Page not found
      </h1>
      <p className="mt-3 max-w-md text-body-md text-muted">
        The page you are looking for does not exist, or it has moved to a new address.
      </p>

      <div className="mt-8 flex w-full max-w-sm flex-col gap-3 sm:w-auto sm:flex-row">
        <Button
          as={Link}
          to={PATHS.HOME}
          variant="gradient"
          leftIcon={<Home className="h-4 w-4" />}
          className="flex-1 sm:flex-none"
        >
          Back to home
        </Button>
        <Button
          as={Link}
          to={PATHS.CONSULT}
          variant="soft"
          leftIcon={<ScanLine className="h-4 w-4" />}
          className="flex-1 sm:flex-none"
        >
          Start a scan
        </Button>
      </div>
    </div>
  );
};

export default NotFound;
