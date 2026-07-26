BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO public, extensions;

SELECT plan(12);

CREATE FUNCTION pg_temp.rating_configuration(glicko jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
	SELECT jsonb_build_object(
		'version', 2,
		'system', 'glicko',
		'defaultRating', 1200,
		'periodDays', 1,
		'glicko', glicko,
		'elo', jsonb_build_object('kFactor', 32, 'scale', 400),
		'custom', jsonb_build_object('formula', 'rating + 32 * (score - expected)')
	)
$$;

CREATE FUNCTION pg_temp.glicko_configuration_rejected(glicko jsonb)
RETURNS boolean
LANGUAGE plpgsql
AS $$
BEGIN
	INSERT INTO public.games (name, rating_configuration)
	VALUES (
		'unexpected-valid-' || md5(glicko::text),
		pg_temp.rating_configuration(glicko)
	);
	RETURN false;
EXCEPTION
	WHEN check_violation OR invalid_text_representation OR numeric_value_out_of_range THEN
		RETURN true;
END
$$;

SELECT lives_ok(
	$$
		INSERT INTO public.games (name, rating_configuration)
		VALUES (
			'glicko-boundary-min',
			pg_temp.rating_configuration(
				'{"initialDeviation":1,"maxDeviation":1,"initialVolatility":0.000001,"tau":0.3}'
			)
		)
	$$,
	'accepts the minimum supported Glicko configuration'
);

SELECT lives_ok(
	$$
		INSERT INTO public.games (name, rating_configuration)
		VALUES (
			'glicko-boundary-max',
			pg_temp.rating_configuration(
				'{"initialDeviation":1000,"maxDeviation":1000,"initialVolatility":0.2,"tau":1.2}'
			)
		)
	$$,
	'accepts the maximum supported Glicko configuration'
);

SELECT ok(
	pg_temp.glicko_configuration_rejected(
		'{"initialDeviation":0,"maxDeviation":350,"initialVolatility":0.06,"tau":0.5}'
	),
	'rejects a zero initial deviation'
);
SELECT ok(
	pg_temp.glicko_configuration_rejected(
		'{"initialDeviation":350,"maxDeviation":1001,"initialVolatility":0.06,"tau":0.5}'
	),
	'rejects a maximum deviation above the supported bound'
);
SELECT ok(
	pg_temp.glicko_configuration_rejected(
		'{"initialDeviation":351,"maxDeviation":350,"initialVolatility":0.06,"tau":0.5}'
	),
	'rejects an initial deviation above the maximum deviation'
);
SELECT ok(
	pg_temp.glicko_configuration_rejected(
		'{"initialDeviation":350,"maxDeviation":350,"initialVolatility":0,"tau":0.5}'
	),
	'rejects a zero initial volatility'
);
SELECT ok(
	pg_temp.glicko_configuration_rejected(
		'{"initialDeviation":350,"maxDeviation":350,"initialVolatility":0.06,"tau":1.21}'
	),
	'rejects tau above the supported bound'
);
SELECT ok(
	pg_temp.glicko_configuration_rejected(
		'{"initialDeviation":"350","maxDeviation":350,"initialVolatility":0.06,"tau":0.5}'
	),
	'rejects non-numeric Glicko parameters'
);
SELECT ok(
	pg_temp.glicko_configuration_rejected(
		'{"initialDeviation":350,"maxDeviation":350,"tau":0.5}'
	),
	'rejects a missing Glicko parameter'
);
SELECT ok(
	pg_temp.glicko_configuration_rejected('[]'),
	'rejects a non-object Glicko configuration'
);

SELECT lives_ok(
	$$
		INSERT INTO public.games (name, rating_configuration)
		SELECT
			'glicko-generated-' || value,
			pg_temp.rating_configuration(
				jsonb_build_object(
					'initialDeviation', 1 + (value % 999),
					'maxDeviation', 1000,
					'initialVolatility', 0.000001 + (value % 1000) * 0.000199,
					'tau', 0.3 + (value % 901) * 0.001
				)
			)
		FROM generate_series(1, 1000) AS value
	$$,
	'persists a large set of distinct valid Glicko configurations'
);

SELECT is(
	(
		SELECT count(*)
		FROM public.games
		WHERE name LIKE 'glicko-generated-%'
	),
	1000::bigint,
	'retains every generated Glicko configuration'
);

SELECT * FROM finish();

ROLLBACK;
