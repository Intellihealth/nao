export function DatahubSignInNotice() {
	return (
		<div className='mx-auto flex min-h-[50vh] max-w-md flex-col justify-center gap-3 px-6 text-center'>
			<h1 className='text-xl font-semibold'>Sign in with DataHub</h1>
			<p className='text-sm text-muted-foreground'>
				This chat uses your DataHub session. Open it from DataHub after you are signed in there.
			</p>
		</div>
	);
}
