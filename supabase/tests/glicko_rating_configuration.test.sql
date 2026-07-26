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
		'version', 1,
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
				'{"initialDeviation":1,"maxDeviation":1,"periodDeviationIncrease":0,"scale":1}'
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
				'{"initialDeviation":1000,"maxDeviation":1000,"periodDeviationIncrease":1000,"scale":10000}'
			)
		)
	$$,
	'accepts the maximum supported Glicko configuration'
);

SELECT ok(
	pg_temp.glicko_configuration_rejected(
		'{"initialDeviation":0,"maxDeviation":350,"periodDeviationIncrease":63.2,"scale":400}'
	),
	'rejects a zero initial deviation'
);
SELECT ok(
	pg_temp.glicko_configuration_rejected(
		'{"initialDeviation":350,"maxDeviation":1001,"periodDeviationIncrease":63.2,"scale":400}'
	),
	'rejects a maximum deviation above the supported bound'
);
SELECT ok(
	pg_temp.glicko_configuration_rejected(
		'{"initialDeviation":351,"maxDeviation":350,"periodDeviationIncrease":63.2,"scale":400}'
	),
	'rejects an initial deviation above the maximum deviation'
);
SELECT ok(
	pg_temp.glicko_configuration_rejected(
		'{"initialDeviation":350,"maxDeviation":350,"periodDeviationIncrease":-1,"scale":400}'
	),
	'rejects a negative period deviation increase'
);
SELECT ok(
	pg_temp.glicko_configuration_rejected(
		'{"initialDeviation":350,"maxDeviation":350,"periodDeviationIncrease":63.2,"scale":10001}'
	),
	'rejects a scale above the supported bound'
);
SELECT ok(
	pg_temp.glicko_configuration_rejected(
		'{"initialDeviation":"350","maxDeviation":350,"periodDeviationIncrease":63.2,"scale":400}'
	),
	'rejects non-numeric Glicko parameters'
);
SELECT ok(
	pg_temp.glicko_configuration_rejected(
		'{"initialDeviation":350,"maxDeviation":350,"scale":400}'
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
					'periodDeviationIncrease', value % 1001,
					'scale', 1 + (value % 10000)
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
