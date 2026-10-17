import { useEffect } from 'react';
import { createFileRoute, Outlet, useNavigate } from '@tanstack/react-router';
import { MobileHeader } from '@/components/mobile-header';
import { useDatahubAuth } from '@/hooks/use-datahub-auth';

export const Route = createFileRoute('/_sidebar-layout/settings')({
	component: SettingsLayout,
});

function SettingsLayout() {
	const datahubAuth = useDatahubAuth();
	const navigate = useNavigate();

	useEffect(() => {
		if (datahubAuth) {
			void navigate({ to: '/' });
		}
	}, [datahubAuth, navigate]);

	if (datahubAuth) {
		return null;
	}

	return (
		<div className='flex flex-1 flex-col bg-panel min-w-0 overflow-hidden'>
			<MobileHeader />
			<Outlet />
		</div>
	);
}
