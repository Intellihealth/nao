import z from 'zod/v3';

export const DATABASE_WAREHOUSE_QUESTION = 'Which database are you using?';
export const DATABASE_WAREHOUSE_OPTIONS = [
	'Amazon Athena',
	'BigQuery',
	'ClickHouse',
	'Databricks',
	'DuckDB',
	'Microsoft Fabric',
	'MotherDuck',
	'Microsoft SQL Server / Azure SQL',
	'MySQL',
	'Postgres',
	'Amazon Redshift',
	'Snowflake',
	'StarRocks',
	'Trino',
] as const;

export const InputSchema = z
	.object({
		question: z
			.string()
			.min(1)
			.describe(
				'A single, focused question to ask the user. Keep it short, specific, and actionable. Ask only one thing at a time.',
			),
		options: z
			.array(
				z
					.string()
					.describe(
						'A short, distinct candidate answer the user can pick with one click. Keep under ~60 chars.',
					),
			)
			.min(2)
			.max(DATABASE_WAREHOUSE_OPTIONS.length)
			.optional()
			.describe(
				'Optional 2-5 mutually exclusive answer choices. The database warehouse question is the only exception and must use the complete supported option list. Provide options whenever the answer is naturally enumerable; omit when the question is open-ended.',
			),
	})
	.superRefine(({ options, question }, context) => {
		if (!options || options.length <= 5) {
			return;
		}

		const warehouseOptions = new Set<string>(DATABASE_WAREHOUSE_OPTIONS);
		const isCompleteWarehouseSelection =
			question === DATABASE_WAREHOUSE_QUESTION &&
			options.length === DATABASE_WAREHOUSE_OPTIONS.length &&
			options.every((option) => warehouseOptions.has(option)) &&
			new Set(options).size === DATABASE_WAREHOUSE_OPTIONS.length;

		if (!isCompleteWarehouseSelection) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				path: ['options'],
				message: 'Only the database warehouse question may contain more than five options.',
			});
		}
	});

export const OutputSchema = z.object({
	_version: z.literal('1').optional(),
	success: z.literal(true),
});

export type Input = z.infer<typeof InputSchema>;
export type Output = z.infer<typeof OutputSchema>;
