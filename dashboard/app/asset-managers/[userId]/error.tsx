"use client";

import Link from "next/link";

export default function AssetManagerError() {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="text-xl font-semibold">Asset manager not found</h1>
      <p className="mt-2 text-[13.5px] text-muted-foreground">That person is not an asset manager on your team, or the link is wrong.</p>
      <Link href="/asset-managers" className="mt-4 inline-block text-[13.5px] font-medium text-primary hover:underline">
        ← Back to Asset Managers
      </Link>
    </div>
  );
}
