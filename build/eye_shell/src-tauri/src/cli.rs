use chrono::{Local, SecondsFormat};
use serde_json::{json, Value};
use std::io::{IsTerminal, Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::time::{Duration, Instant};

pub const TOOL: &str = "holographic-eye";
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
pub const PLANE: &str = "http://127.0.0.1:8770";
const USAGE: &str = "holographic-eye [help|version|schema|status|probe] [--json]";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Command {
    Gui,
    Help,
    Version,
    Schema,
    Status,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Route {
    pub command: Command,
    pub json: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UsageError {
    pub error: String,
    pub fix: String,
}

#[derive(Debug, Clone)]
pub struct GatewayHealth {
    pub available: bool,
    pub detail: String,
}

#[derive(Debug, Clone)]
struct TokenHealth {
    available: bool,
    detail: String,
}

pub fn parse_args<I, S>(args: I) -> Result<Route, UsageError>
where
    I: IntoIterator<Item = S>,
    S: Into<String>,
{
    let mut args: Vec<String> = args.into_iter().map(Into::into).collect();
    let json = args.iter().any(|arg| arg == "--json");
    args.retain(|arg| arg != "--json");

    if args.is_empty() {
        return if json {
            Err(UsageError {
                error: "--json requires a CLI command".into(),
                fix: format!("Use: {USAGE}"),
            })
        } else {
            Ok(Route {
                command: Command::Gui,
                json: false,
            })
        };
    }

    let command = match args.as_slice() {
        [arg] if matches!(arg.as_str(), "help" | "--help" | "-h") => Command::Help,
        [arg] if matches!(arg.as_str(), "version" | "--version" | "-V") => Command::Version,
        [arg] if matches!(arg.as_str(), "schema" | "--schema") => Command::Schema,
        [arg] if matches!(arg.as_str(), "status" | "probe") => Command::Status,
        _ => {
            return Err(UsageError {
                error: format!("unknown or invalid arguments: {}", args.join(" ")),
                fix: format!("Use: {USAGE}"),
            })
        }
    };

    Ok(Route { command, json })
}

pub fn run(route: Route) -> i32 {
    let structured = route.json || !std::io::stdout().is_terminal();
    match route.command {
        Command::Gui => 0,
        Command::Help => {
            if structured {
                print_json(help_value());
            } else {
                println!("{}", help_text());
            }
            0
        }
        Command::Version => {
            if structured {
                print_json(json!({
                    "status": "ok",
                    "tool": TOOL,
                    "version": VERSION,
                    "ts": timestamp(),
                    "command": "version"
                }));
            } else {
                println!("{TOOL} {VERSION}");
            }
            0
        }
        Command::Schema => {
            print_json(schema_value());
            0
        }
        Command::Status => run_status(structured),
    }
}

pub fn emit_usage_error(error: &UsageError, force_json: bool) {
    let structured = force_json || !std::io::stdout().is_terminal();
    if structured {
        print_json(json!({
            "status": "error",
            "tool": TOOL,
            "version": VERSION,
            "ts": timestamp(),
            "error": error.error,
            "fix": error.fix,
            "usage": USAGE,
            "exit": 3
        }));
    } else {
        eprintln!("Error: {}\nFix: {}", error.error, error.fix);
    }
}

pub fn emit_runtime_error(error: &str) {
    if std::io::stdout().is_terminal() {
        eprintln!("The Holographic Eye could not open: {error}");
        eprintln!("Fix: Run `holographic-eye status`, apply its fix, then retry.");
    } else {
        print_json(json!({
            "status": "error",
            "tool": TOOL,
            "version": VERSION,
            "ts": timestamp(),
            "error": format!("the graphical shell could not open: {error}"),
            "fix": "Run `holographic-eye status`, apply its fix, then retry.",
            "exit": 4
        }));
    }
}

fn run_status(structured: bool) -> i32 {
    let gateway = gateway_health();
    let token = token_health();
    let available = gateway.available && token.available;
    let gateway_json = json!({
        "available": gateway.available,
        "url": PLANE,
        "detail": gateway.detail
    });
    let token_json = json!({
        "present_readable": token.available,
        "path": "~/.hermes/eye_token",
        "detail": token.detail
    });

    if available {
        if structured {
            print_json(json!({
                "status": "ok",
                "tool": TOOL,
                "version": VERSION,
                "ts": timestamp(),
                "command": "status",
                "gateway": gateway_json,
                "token": token_json
            }));
        } else {
            println!(
                "The Holographic Eye {VERSION}\nGateway: ready at {PLANE}\nToken: present and readable at ~/.hermes/eye_token"
            );
        }
        0
    } else {
        let (error, fix) = status_error(&gateway, &token);
        if structured {
            print_json(json!({
                "status": "error",
                "tool": TOOL,
                "version": VERSION,
                "ts": timestamp(),
                "command": "status",
                "error": error,
                "fix": fix,
                "gateway": gateway_json,
                "token": token_json,
                "exit": 2
            }));
        } else {
            println!(
                "The Holographic Eye {VERSION}\nGateway: {}\nToken: {}\nError: {error}\nFix: {fix}",
                gateway.detail, token.detail
            );
        }
        2
    }
}

fn status_error(gateway: &GatewayHealth, token: &TokenHealth) -> (&'static str, &'static str) {
    match (gateway.available, token.available) {
        (false, false) => (
            "the gateway and bearer token are unavailable",
            "Start the Hermes gateway with the holographic-eye provider enabled, then retry.",
        ),
        (false, true) => (
            "the Holographic Eye control plane is unavailable",
            "Run `hermes gateway start`, then retry this command.",
        ),
        (true, false) => (
            "the Holographic Eye bearer token is unavailable",
            "Start the holographic-eye provider once so it creates ~/.hermes/eye_token, then retry.",
        ),
        (true, true) => unreachable!(),
    }
}

const MAX_HTTP_RESPONSE: usize = 16 * 1024;
const HEALTH_DEADLINE: Duration = Duration::from_millis(1_000);

#[derive(Default)]
struct HealthResponse {
    bytes: Vec<u8>,
    expected: Option<usize>,
}

impl HealthResponse {
    fn push(&mut self, chunk: &[u8]) -> Result<bool, String> {
        if self.bytes.len().saturating_add(chunk.len()) > MAX_HTTP_RESPONSE {
            return Err(format!(
                "health response exceeded {MAX_HTTP_RESPONSE} bytes"
            ));
        }
        self.bytes.extend_from_slice(chunk);

        if self.expected.is_none() {
            let Some(header_end) = find_header_end(&self.bytes) else {
                return Ok(false);
            };
            let content_length = parse_headers(&self.bytes[..header_end])?;
            let expected = header_end
                .checked_add(4)
                .and_then(|start| start.checked_add(content_length))
                .ok_or_else(|| "health response length overflowed".to_string())?;
            if expected > MAX_HTTP_RESPONSE {
                return Err(format!(
                    "health response exceeded {MAX_HTTP_RESPONSE} bytes"
                ));
            }
            self.expected = Some(expected);
        }

        let expected = self
            .expected
            .ok_or_else(|| "health response length was not resolved".to_string())?;
        if self.bytes.len() < expected {
            return Ok(false);
        }
        if self.bytes.len() > expected {
            return Err("health response contained bytes beyond Content-Length".into());
        }
        let body_start = find_header_end(&self.bytes)
            .map(|end| end + 4)
            .ok_or_else(|| "health response headers disappeared".to_string())?;
        validate_health_body(&self.bytes[body_start..])?;
        Ok(true)
    }

    fn finish(&self) -> Result<(), String> {
        Err(match self.expected {
            Some(expected) => format!(
                "health response was truncated (received {} of {expected} bytes)",
                self.bytes.len()
            ),
            None => "health response ended before complete headers".into(),
        })
    }
}

pub fn gateway_health() -> GatewayHealth {
    match request_gateway_health() {
        Ok(()) => GatewayHealth {
            available: true,
            detail: "ready and attached".into(),
        },
        Err(error) => GatewayHealth {
            available: false,
            detail: format!("unavailable ({error})"),
        },
    }
}

fn request_gateway_health() -> Result<(), String> {
    let deadline = Instant::now() + HEALTH_DEADLINE;
    let address = SocketAddr::from(([127, 0, 0, 1], 8770));
    let mut stream = TcpStream::connect_timeout(&address, remaining(deadline)?)
        .map_err(|error| format!("connection failed: {error}"))?;
    stream
        .set_write_timeout(Some(remaining(deadline)?))
        .map_err(|error| format!("could not set write timeout: {error}"))?;
    stream
        .write_all(b"GET /health HTTP/1.1\r\nHost: 127.0.0.1:8770\r\nConnection: close\r\n\r\n")
        .map_err(|error| format!("health request failed: {error}"))?;

    let mut response = HealthResponse::default();
    let mut chunk = [0_u8; 1024];
    loop {
        stream
            .set_read_timeout(Some(remaining(deadline)?))
            .map_err(|error| format!("could not set read timeout: {error}"))?;
        match stream.read(&mut chunk) {
            Ok(0) => return response.finish(),
            Ok(size) if response.push(&chunk[..size])? => return Ok(()),
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(error) => return Err(format!("health response failed: {error}")),
        }
    }
}

fn remaining(deadline: Instant) -> Result<Duration, String> {
    deadline
        .checked_duration_since(Instant::now())
        .filter(|remaining| !remaining.is_zero())
        .ok_or_else(|| "health check reached its one-second deadline".into())
}

fn find_header_end(response: &[u8]) -> Option<usize> {
    response.windows(4).position(|bytes| bytes == b"\r\n\r\n")
}

fn parse_headers(headers: &[u8]) -> Result<usize, String> {
    let headers = std::str::from_utf8(headers)
        .map_err(|_| "health response headers were not valid UTF-8".to_string())?;
    let mut lines = headers.split("\r\n");
    let status = lines
        .next()
        .ok_or_else(|| "health response had no status line".to_string())?;
    let mut status_parts = status.split_whitespace();
    let protocol = status_parts.next().unwrap_or_default();
    let status_code = status_parts.next().unwrap_or_default();
    if !matches!(protocol, "HTTP/1.0" | "HTTP/1.1") || status_code != "200" {
        return Err(format!("health endpoint returned {status}"));
    }

    let mut content_length = None;
    for line in lines {
        let Some((name, value)) = line.split_once(':') else {
            return Err("health response contained a malformed header".into());
        };
        if name.eq_ignore_ascii_case("content-length") {
            if content_length.is_some() {
                return Err("health response repeated Content-Length".into());
            }
            content_length = Some(
                value
                    .trim()
                    .parse::<usize>()
                    .map_err(|_| "health response had an invalid Content-Length".to_string())?,
            );
        }
    }
    content_length.ok_or_else(|| "health response had no Content-Length".into())
}

fn validate_health_body(body: &[u8]) -> Result<(), String> {
    let value: Value = serde_json::from_slice(body)
        .map_err(|error| format!("health response was not valid JSON: {error}"))?;
    if value.get("ok") != Some(&Value::Bool(true)) {
        return Err("health response did not report ok=true".into());
    }
    if value.get("app").and_then(Value::as_str) != Some("holographic-eye") {
        return Err("health response identified a different application".into());
    }
    if value.get("attached") != Some(&Value::Bool(true)) {
        return Err("health response did not report attached=true".into());
    }
    Ok(())
}

fn token_health() -> TokenHealth {
    let Some(path) = token_path() else {
        return TokenHealth {
            available: false,
            detail: "home directory is unavailable".into(),
        };
    };
    match std::fs::read_to_string(path) {
        Ok(token) if !token.trim().is_empty() => TokenHealth {
            available: true,
            detail: "present and readable".into(),
        },
        Ok(_) => TokenHealth {
            available: false,
            detail: "token file is empty".into(),
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => TokenHealth {
            available: false,
            detail: "token file is missing".into(),
        },
        Err(error) => TokenHealth {
            available: false,
            detail: format!("token file is unreadable ({error})"),
        },
    }
}

pub fn read_token() -> Option<String> {
    token_path()
        .and_then(|path| std::fs::read_to_string(path).ok())
        .map(|token| token.trim().to_owned())
        .filter(|token| !token.is_empty())
}

fn token_path() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join(".hermes").join("eye_token"))
}

fn help_text() -> String {
    format!(
        "The Holographic Eye {VERSION}\n\nUsage: {USAGE}\n\nCommands:\n  help       Show this help.\n  version    Show the installed shell version.\n  schema     Show the complete JSON interface contract.\n  status     Check the loopback gateway and local token without changing them.\n  probe      Alias for status.\n\nOptions:\n  --json     Force one JSON object on stdout. Pipes select JSON automatically.\n  -h, --help Show help.\n  -V, --version Show the version.\n\nRun without arguments to open the graphical Eye."
    )
}

fn help_value() -> Value {
    json!({
        "status": "ok",
        "tool": TOOL,
        "version": VERSION,
        "ts": timestamp(),
        "command": "help",
        "usage": USAGE,
        "commands": [
            {"name": "launch", "command": "holographic-eye", "summary": "Open the graphical Eye."},
            {"name": "help", "command": "holographic-eye help [--json]", "summary": "Show CLI help."},
            {"name": "version", "command": "holographic-eye version [--json]", "summary": "Show the shell version."},
            {"name": "schema", "command": "holographic-eye schema", "summary": "Show the JSON interface contract."},
            {"name": "status", "command": "holographic-eye status [--json]", "summary": "Check the gateway and token without changing them."},
            {"name": "probe", "command": "holographic-eye probe [--json]", "summary": "Alias for status."}
        ]
    })
}

fn schema_value() -> Value {
    let envelope_properties = json!({
        "status": {"enum": ["ok", "error"]},
        "tool": {"const": TOOL},
        "version": {"type": "string"},
        "ts": {"type": "string", "format": "date-time"}
    });
    json!({
        "status": "ok",
        "tool": TOOL,
        "version": VERSION,
        "ts": timestamp(),
        "command": "schema",
        "schema_version": "1",
        "interface": {
            "usage": USAGE,
            "output": "TTY output is text. Piped output is one JSON object. --json forces JSON. Schema is always JSON.",
            "commands": [
                {"name": "launch", "shape": "holographic-eye", "mode": "graphical", "mutates": false, "exits": [0, 4]},
                {"name": "help", "shape": "holographic-eye help [--json]", "mode": "one-shot", "mutates": false, "exits": [0, 3]},
                {"name": "version", "shape": "holographic-eye version [--json]", "aliases": ["--version", "-V"], "mode": "one-shot", "mutates": false, "exits": [0, 3]},
                {"name": "schema", "shape": "holographic-eye schema", "aliases": ["--schema"], "mode": "always-json one-shot", "mutates": false, "exits": [0, 3]},
                {"name": "status", "shape": "holographic-eye status [--json]", "aliases": ["probe"], "mode": "one-shot", "mutates": false, "exits": [0, 2, 3]}
            ],
            "exit_codes": {
                "0": "ok",
                "2": "the gateway or token is unavailable",
                "3": "bad arguments or an unknown command",
                "4": "the graphical shell failed at runtime"
            },
            "outputs": {
                "schema": schema_response_schema(),
                "version": strict_object(
                    ["status", "tool", "version", "ts", "command"],
                    json!({
                        "status": {"const": "ok"},
                        "tool": {"const": TOOL},
                        "version": {"type": "string"},
                        "ts": {"type": "string", "format": "date-time"},
                        "command": {"const": "version"}
                    })
                ),
                "help": strict_object(
                    ["status", "tool", "version", "ts", "command", "usage", "commands"],
                    json!({
                        "status": {"const": "ok"},
                        "tool": {"const": TOOL},
                        "version": {"type": "string"},
                        "ts": {"type": "string", "format": "date-time"},
                        "command": {"const": "help"},
                        "usage": {"type": "string"},
                        "commands": {"type": "array", "items": strict_object(
                            ["name", "command", "summary"],
                            json!({"name": {"type": "string"}, "command": {"type": "string"}, "summary": {"type": "string"}})
                        )}
                    })
                ),
                "status_ok": strict_object(
                    ["status", "tool", "version", "ts", "command", "gateway", "token"],
                    json!({
                        "status": {"const": "ok"},
                        "tool": {"const": TOOL},
                        "version": {"type": "string"},
                        "ts": {"type": "string", "format": "date-time"},
                        "command": {"const": "status"},
                        "gateway": gateway_schema(),
                        "token": token_schema()
                    })
                ),
                "status_error": strict_object(
                    ["status", "tool", "version", "ts", "command", "error", "fix", "gateway", "token", "exit"],
                    json!({
                        "status": {"const": "error"},
                        "tool": {"const": TOOL},
                        "version": {"type": "string"},
                        "ts": {"type": "string", "format": "date-time"},
                        "command": {"const": "status"},
                        "error": {"type": "string"},
                        "fix": {"type": "string"},
                        "gateway": gateway_schema(),
                        "token": token_schema(),
                        "exit": {"const": 2}
                    })
                ),
                "usage_error": strict_object(
                    ["status", "tool", "version", "ts", "error", "fix", "usage", "exit"],
                    json!({
                        "status": {"const": "error"},
                        "tool": {"const": TOOL},
                        "version": {"type": "string"},
                        "ts": {"type": "string", "format": "date-time"},
                        "error": {"type": "string"},
                        "fix": {"type": "string"},
                        "usage": {"type": "string"},
                        "exit": {"const": 3}
                    })
                ),
                "runtime_error": strict_object(
                    ["status", "tool", "version", "ts", "error", "fix", "exit"],
                    json!({
                        "status": {"const": "error"},
                        "tool": {"const": TOOL},
                        "version": {"type": "string"},
                        "ts": {"type": "string", "format": "date-time"},
                        "error": {"type": "string"},
                        "fix": {"type": "string"},
                        "exit": {"const": 4}
                    })
                )
            },
            "envelope": strict_object(
                ["status", "tool", "version", "ts"],
                envelope_properties
            )
        }
    })
}

fn schema_response_schema() -> Value {
    strict_object(
        [
            "status",
            "tool",
            "version",
            "ts",
            "command",
            "schema_version",
            "interface",
        ],
        json!({
            "status": {"const": "ok"},
            "tool": {"const": TOOL},
            "version": {"type": "string"},
            "ts": {"type": "string", "format": "date-time"},
            "command": {"const": "schema"},
            "schema_version": {"type": "string"},
            "interface": {"type": "object"}
        }),
    )
}

fn gateway_schema() -> Value {
    strict_object(
        ["available", "url", "detail"],
        json!({
            "available": {"type": "boolean"},
            "url": {"const": PLANE},
            "detail": {"type": "string"}
        }),
    )
}

fn token_schema() -> Value {
    strict_object(
        ["present_readable", "path", "detail"],
        json!({
            "present_readable": {"type": "boolean", "description": "True only when the local token file is present, non-empty, and readable. This is not an authentication check."},
            "path": {"const": "~/.hermes/eye_token"},
            "detail": {"type": "string"}
        }),
    )
}

fn strict_object<const N: usize>(required: [&str; N], properties: Value) -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": required.as_slice(),
        "properties": properties
    })
}

fn timestamp() -> String {
    Local::now().to_rfc3339_opts(SecondsFormat::Secs, false)
}

fn print_json(value: Value) {
    println!("{value}");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_arguments_routes_to_gui() {
        assert_eq!(
            parse_args(Vec::<String>::new()).unwrap(),
            Route {
                command: Command::Gui,
                json: false
            }
        );
    }

    #[test]
    fn cli_aliases_route_without_opening_the_gui() {
        for (args, command) in [
            (vec!["--version"], Command::Version),
            (vec!["version"], Command::Version),
            (vec!["--schema"], Command::Schema),
            (vec!["probe"], Command::Status),
            (vec!["--help"], Command::Help),
        ] {
            assert_eq!(parse_args(args).unwrap().command, command);
        }
    }

    #[test]
    fn json_is_a_global_option() {
        assert_eq!(
            parse_args(["--json", "status"]).unwrap(),
            Route {
                command: Command::Status,
                json: true
            }
        );
        assert_eq!(
            parse_args(["version", "--json"]).unwrap(),
            Route {
                command: Command::Version,
                json: true
            }
        );
    }

    #[test]
    fn unknown_arguments_carry_a_fix() {
        let error = parse_args(["nonsense"]).unwrap_err();
        assert!(error.error.contains("nonsense"));
        assert!(error.fix.contains(USAGE));
    }

    #[test]
    fn json_without_a_command_is_not_a_gui_launch() {
        assert!(parse_args(["--json"]).is_err());
    }

    fn response(status: &str, body: &str, length: Option<usize>) -> Vec<u8> {
        format!(
            "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}",
            length.unwrap_or(body.len())
        )
        .into_bytes()
    }

    #[test]
    fn health_parser_waits_for_split_headers_and_body() {
        let bytes = response(
            "200 OK",
            r#"{"ok":true,"app":"holographic-eye","attached":true}"#,
            None,
        );
        let mut health = HealthResponse::default();
        let chunks: Vec<&[u8]> = bytes.chunks(3).collect();
        for chunk in &chunks[..chunks.len() - 1] {
            assert!(!health.push(chunk).unwrap());
        }
        assert!(health.push(chunks[chunks.len() - 1]).unwrap());
    }

    #[test]
    fn health_parser_rejects_detached_or_wrong_app() {
        for (body, expected) in [
            (
                r#"{"ok":true,"app":"holographic-eye","attached":false}"#,
                "attached=true",
            ),
            (
                r#"{"ok":true,"app":"different-app","attached":true}"#,
                "different application",
            ),
        ] {
            let mut health = HealthResponse::default();
            let error = health.push(&response("200 OK", body, None)).unwrap_err();
            assert!(error.contains(expected));
        }
    }

    #[test]
    fn health_parser_rejects_truncated_body() {
        let body = r#"{"ok":true,"app":"holographic-eye","attached":true}"#;
        let mut health = HealthResponse::default();
        assert!(!health
            .push(&response("200 OK", body, Some(body.len() + 8)))
            .unwrap());
        assert!(health.finish().unwrap_err().contains("truncated"));
    }

    #[test]
    fn health_parser_rejects_oversized_response() {
        let mut health = HealthResponse::default();
        let headers = response("200 OK", "", Some(MAX_HTTP_RESPONSE));
        assert!(health.push(&headers).unwrap_err().contains("exceeded"));
    }

    #[test]
    fn health_parser_requires_http_200_and_ok_true() {
        for (status, body) in [
            (
                "204 No Content",
                r#"{"ok":true,"app":"holographic-eye","attached":true}"#,
            ),
            (
                "200 OK",
                r#"{"ok":false,"app":"holographic-eye","attached":true}"#,
            ),
        ] {
            let mut health = HealthResponse::default();
            assert!(health.push(&response(status, body, None)).is_err());
        }
    }

    #[test]
    fn published_output_schemas_are_strict() {
        let schema = schema_value();
        let outputs = schema["interface"]["outputs"].as_object().unwrap();
        assert!(outputs
            .values()
            .all(|output| output["additionalProperties"] == false));
        assert_eq!(outputs["schema"]["type"], "object");
        assert!(outputs["schema"]["required"]
            .as_array()
            .unwrap()
            .iter()
            .any(|field| field == "interface"));
    }
}
