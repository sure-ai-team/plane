/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Skeleton } from "@plane/propel/skeleton";
import { cn } from "@plane/utils";

type TSkeletonParagraph = { key: string; lines: { key: string; width: string }[]; withHeading?: boolean };

const line = (key: string, width: string) => ({ key, width });

const PARAGRAPHS: TSkeletonParagraph[] = [
  { key: "intro", lines: [line("a", "100%"), line("b", "96%"), line("c", "88%"), line("d", "62%")] },
  { key: "section", withHeading: true, lines: [line("a", "100%"), line("b", "92%"), line("c", "71%")] },
  { key: "details", lines: [line("a", "98%"), line("b", "100%"), line("c", "84%"), line("d", "45%")] },
];

/** Document-shaped placeholder: a heading followed by paragraphs, with a sub-heading between them. */
export function ReadmeContentSkeleton(props: { className?: string }) {
  const { className } = props;
  return (
    <Skeleton className={cn("flex w-full flex-col gap-6 py-2", className)}>
      <Skeleton.Item height="28px" width="45%" />
      {PARAGRAPHS.map((paragraph) => (
        <div key={paragraph.key} className="flex flex-col gap-2.5">
          {paragraph.withHeading && <Skeleton.Item height="20px" width="30%" className="mb-1.5" />}
          {paragraph.lines.map((item) => (
            <Skeleton.Item key={item.key} height="14px" width={item.width} />
          ))}
        </div>
      ))}
    </Skeleton>
  );
}

/** The README surface while it loads: the header row plus the document. */
export function ReadmeSkeleton() {
  return (
    <div className="flex w-full flex-col gap-6">
      <Skeleton className="flex items-center justify-between gap-4 border-b border-subtle pb-4">
        <div className="flex items-center gap-2">
          <Skeleton.Item height="20px" width="20px" className="rounded-full" />
          <Skeleton.Item height="14px" width="180px" />
        </div>
        <Skeleton.Item height="28px" width="64px" />
      </Skeleton>
      <ReadmeContentSkeleton />
    </div>
  );
}
