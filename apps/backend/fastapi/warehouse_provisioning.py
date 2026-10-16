import json

from nao_core.config.databases import parse_database_config

AUTH_FIELDS = {
    "athena": ["aws_access_key_id", "aws_secret_access_key", "aws_session_token"],
    "bigquery": ["credentials_json"],
    "clickhouse": ["user", "password"],
    "databricks": ["access_token"],
    "fabric": ["client_id", "client_secret", "tenant_id"],
    "motherduck": ["token"],
    "mssql": ["user", "password"],
    "mysql": ["user", "password"],
    "postgres": ["user", "password"],
    "redshift": ["user", "password"],
    "snowflake": ["username", "password"],
    "starrocks": ["user", "password"],
    "trino": ["user", "password"],
}

ENDPOINT_FIELDS = {
    "athena": ["region_name", "s3_staging_dir"],
    "bigquery": ["project_id", "location"],
    "clickhouse": ["host", "port", "protocol"],
    "databricks": ["server_hostname", "http_path"],
    "fabric": ["host", "port"],
    "motherduck": ["database"],
    "mssql": ["host", "port"],
    "mysql": ["host", "port"],
    "postgres": ["host", "port"],
    "redshift": ["host", "port"],
    "snowflake": ["account_id"],
    "starrocks": ["host", "port"],
    "trino": ["host", "port", "http_scheme"],
}


def validate_warehouse_credentials(
    provider: str,
    credentials: dict[str, object],
) -> None:
    config = parse_database_config(
        {
            **credentials,
            "type": provider,
            "name": provider,
        }
    )
    connection = config.connect()
    try:
        config.get_schemas(connection)
    finally:
        connection.disconnect()


def infer_warehouse_error_fields(provider: str, error: Exception) -> list[str]:
    message = str(error).lower()

    if "dataset" in message:
        return ["dataset_id"]
    if "schema" in message:
        return ["schema_name"]
    if "catalog" in message:
        return ["catalog"]
    if "database" in message and any(
        phrase in message for phrase in ("does not exist", "not found", "unknown")
    ):
        return ["database"]
    if any(
        phrase in message
        for phrase in (
            "authentication",
            "access denied",
            "invalid credential",
            "invalid_grant",
            "login failed",
            "password",
            "unauthorized",
            "forbidden",
            "401",
            "403",
            "token",
        )
    ):
        return AUTH_FIELDS.get(provider, [])
    if any(
        phrase in message
        for phrase in (
            "connection refused",
            "could not connect",
            "name or service not known",
            "network",
            "no route to host",
            "timed out",
            "timeout",
            "unknown host",
        )
    ):
        return ENDPOINT_FIELDS.get(provider, [])

    return []


def prepare_warehouse_config(
    provider: str,
    credentials: dict[str, object],
) -> tuple[dict[str, object], dict[str, str]]:
    config = parse_database_config(
        {
            **credentials,
            "type": provider,
            "name": provider,
        }
    )

    database_config = {
        "type": provider,
        "name": provider,
    }
    env_vars: dict[str, str] = {}
    values = config.model_dump(include=config.model_fields_set, mode="json")

    for field_name in sorted(config.model_fields_set - {"type", "name"}):
        value = values[field_name]
        if value is None:
            continue

        database_config[field_name] = replace_with_env_references(
            value,
            [provider, field_name],
            env_vars,
        )

    return database_config, env_vars


def replace_with_env_references(
    value: object,
    path: list[str],
    env_vars: dict[str, str],
) -> object:
    if isinstance(value, dict):
        return {
            str(key): replace_with_env_references(
                nested_value,
                [*path, str(key)],
                env_vars,
            )
            for key, nested_value in value.items()
        }

    if isinstance(value, list):
        return [
            replace_with_env_references(
                nested_value,
                [*path, str(index)],
                env_vars,
            )
            for index, nested_value in enumerate(value)
        ]

    if value is None:
        return None

    env_name = "NAO_ONBOARDING_" + "_".join(
        part.upper().replace("-", "_") for part in path
    )
    if env_name in env_vars:
        raise ValueError(f"Conflicting onboarding environment variable: {env_name}")
    env_vars[env_name] = json.dumps(value)

    return f"${{{{ env('{env_name}') }}}}"
