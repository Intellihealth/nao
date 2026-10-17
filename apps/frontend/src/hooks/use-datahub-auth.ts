import { useQuery } from '@tanstack/react-query';

import { trpc } from '@/main';

export function usePublicConfig() {
	return useQuery(trpc.system.getPublicConfig.queryOptions());
}

export function useDatahubAuth(): boolean {
	return Boolean(usePublicConfig().data?.datahubAuth);
}
