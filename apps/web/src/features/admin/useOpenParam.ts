'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';

/** Opens a dialog named in ?open= (from the command palette), then drops the parameter from the address. */
export function useOpenParam(name: string, open: () => void): void {
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const wanted = params.get('open') === name;
  useEffect(() => {
    if (!wanted) return;
    open();
    const rest = new URLSearchParams(params);
    rest.delete('open');
    router.replace(rest.size ? `${path}?${rest}` : path);
  }, [wanted, open, params, path, router]);
}
