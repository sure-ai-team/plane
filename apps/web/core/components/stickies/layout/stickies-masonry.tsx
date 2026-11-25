/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import Masonry from "react-masonry-component";

export type TStickiesMasonryRef = {
  performLayout: () => void;
};

type TMasonryInstance = TStickiesMasonryRef & {
  // the layout library marks the container it manages with this property
  masonryContainer: (HTMLElement & { outlayerGUID?: number }) | null;
  initializeMasonry: (force?: boolean) => void;
};

type TProps = {
  children: React.ReactNode;
};

export const StickiesMasonry = forwardRef(function StickiesMasonry(
  props: TProps,
  ref: React.ForwardedRef<TStickiesMasonryRef | null>
) {
  const { children } = props;
  // refs
  const masonryRef = useRef<TMasonryInstance | null>(null);

  useImperativeHandle(ref, () => ({ performLayout: () => masonryRef.current?.performLayout() }), []);

  // react-masonry-component destroys its layout when it unmounts but does not create a
  // new one when the same instance mounts again, which React's StrictMode does in
  // development: the notes would be stacked in a single column.
  useEffect(() => {
    const masonry = masonryRef.current;
    if (masonry?.masonryContainer && !masonry.masonryContainer.outlayerGUID) masonry.initializeMasonry(true);
  }, []);

  return (
    // @ts-expect-error type mismatch here
    <Masonry elementType="div" ref={masonryRef}>
      {children}
    </Masonry>
  );
});
