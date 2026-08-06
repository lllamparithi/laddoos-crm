import Image from "next/image";

import { cn } from "@/lib/utils";

/**
 * The Azul Elefant brand mark.
 *
 * Single source for every place the logo appears (sidebar header, and
 * the login / signup / forgot-password cards) so the plate treatment
 * can't drift between them.
 *
 * The plate is white in BOTH light and dark mode on purpose. The mark
 * is drawn as a dark navy outline over a light gradient, so on a dark
 * surface the outline all but disappears — white keeps it legible
 * either way, and in light mode it simply blends into the card behind
 * it while the mark's own outline carries the shape.
 *
 * `unoptimized` because `sharp` is not a dependency and the app ships
 * as a standalone build, so Next's image optimizer has nothing to run
 * on. The asset is a small fixed-size PNG; there is nothing to gain
 * from it regardless.
 *
 * The asset is 96px so it stays crisp when rendered at up to 32px on a
 * 3x display. Callers set the box size and corner radius — the image
 * fills whatever box it's given.
 *
 * `alt=""` throughout: every current placement sits next to a wordmark
 * or a heading that already names the product, so announcing the logo
 * would just be duplicate noise for a screen reader.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden bg-white",
        className,
      )}
    >
      <Image
        src="/brand/azul-elefant-mark.png"
        alt=""
        width={96}
        height={96}
        unoptimized
        priority
        className="h-full w-full object-contain"
      />
    </div>
  );
}
