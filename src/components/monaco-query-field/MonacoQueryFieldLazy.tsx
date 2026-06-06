import React, { lazy, Suspense } from 'react';

import { Props } from './MonacoQueryFieldProps';

const Field = lazy(() => import('./MonacoQueryField'));

export const MonacoQueryFieldLazy = (props: Props) => {
  return (
    <Suspense fallback={null}>
      <Field {...props} />
    </Suspense>
  );
};
