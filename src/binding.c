/**
 * @file binding.c
 * @brief Pure C N-API binding for stdio_bus
 *
 * This file provides the Node.js native addon using Node-API (N-API) C ABI.
 * No C++ required - pure C implementation.
 */

#include <node_api.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>

#include "stdio_bus.h"
#include "stdio_bus_embed.h"

/*============================================================================
 * Addon State
 *============================================================================*/

typedef struct {
    stdio_bus_t *bus;
    napi_env env;
    napi_ref on_message_ref;
    napi_ref on_error_ref;
    napi_ref on_log_ref;
    napi_ref on_worker_ref;
    napi_threadsafe_function tsfn_message;
    napi_threadsafe_function tsfn_error;
} addon_state_t;

static addon_state_t *g_state = NULL;

/*============================================================================
 * Helper Macros
 *============================================================================*/

#define NAPI_CALL(env, call)                                      \
    do {                                                          \
        napi_status status = (call);                              \
        if (status != napi_ok) {                                  \
            const napi_extended_error_info *error_info = NULL;    \
            napi_get_last_error_info((env), &error_info);         \
            const char *msg = error_info->error_message;          \
            napi_throw_error((env), NULL, msg ? msg : "N-API error"); \
            return NULL;                                          \
        }                                                         \
    } while (0)

#define NAPI_CALL_VOID(env, call)                                 \
    do {                                                          \
        napi_status status = (call);                              \
        if (status != napi_ok) {                                  \
            const napi_extended_error_info *error_info = NULL;    \
            napi_get_last_error_info((env), &error_info);         \
            const char *msg = error_info->error_message;          \
            napi_throw_error((env), NULL, msg ? msg : "N-API error"); \
            return;                                               \
        }                                                         \
    } while (0)

/*============================================================================
 * Message Queue (for thread-safe callback delivery)
 *============================================================================*/

typedef struct msg_node {
    char *data;
    size_t len;
    struct msg_node *next;
} msg_node_t;

static msg_node_t *g_msg_head = NULL;
static msg_node_t *g_msg_tail = NULL;

static void queue_message(const char *msg, size_t len) {
    msg_node_t *node = malloc(sizeof(msg_node_t));
    if (!node) return;
    
    node->data = malloc(len + 1);
    if (!node->data) {
        free(node);
        return;
    }
    
    memcpy(node->data, msg, len);
    node->data[len] = '\0';
    node->len = len;
    node->next = NULL;
    
    if (g_msg_tail) {
        g_msg_tail->next = node;
        g_msg_tail = node;
    } else {
        g_msg_head = g_msg_tail = node;
    }
}

static msg_node_t *dequeue_message(void) {
    if (!g_msg_head) return NULL;
    
    msg_node_t *node = g_msg_head;
    g_msg_head = node->next;
    if (!g_msg_head) g_msg_tail = NULL;
    
    return node;
}

static void free_message(msg_node_t *node) {
    if (node) {
        free(node->data);
        free(node);
    }
}

/*============================================================================
 * Callbacks from C library
 *============================================================================*/

static void on_message_cb(stdio_bus_t *bus, const char *msg, size_t len, void *user_data) {
    (void)bus;
    (void)user_data;
    queue_message(msg, len);
}

static void on_error_cb(stdio_bus_t *bus, int code, const char *message, void *user_data) {
    (void)bus;
    (void)user_data;
    /* For now, just log to stderr */
    fprintf(stderr, "[stdio_bus] Error %d: %s\n", code, message);
}

static void on_log_cb(stdio_bus_t *bus, int level, const char *message, void *user_data) {
    (void)bus;
    (void)user_data;
    const char *levels[] = {"DEBUG", "INFO", "WARN", "ERROR"};
    fprintf(stderr, "[stdio_bus] %s: %s\n", levels[level < 4 ? level : 3], message);
}

/*============================================================================
 * N-API Functions
 *============================================================================*/

/**
 * Helper to get string property from object
 */
static char *get_string_property(napi_env env, napi_value obj, const char *name) {
    napi_value prop;
    napi_status status = napi_get_named_property(env, obj, name, &prop);
    if (status != napi_ok) return NULL;
    
    napi_valuetype type;
    napi_typeof(env, prop, &type);
    if (type != napi_string) return NULL;
    
    size_t str_len;
    napi_get_value_string_utf8(env, prop, NULL, 0, &str_len);
    
    char *str = malloc(str_len + 1);
    if (!str) return NULL;
    
    napi_get_value_string_utf8(env, prop, str, str_len + 1, &str_len);
    return str;
}

/**
 * Helper to get int32 property from object
 */
static int32_t get_int32_property(napi_env env, napi_value obj, const char *name, int32_t default_val) {
    napi_value prop;
    napi_status status = napi_get_named_property(env, obj, name, &prop);
    if (status != napi_ok) return default_val;
    
    napi_valuetype type;
    napi_typeof(env, prop, &type);
    if (type != napi_number) return default_val;
    
    int32_t val;
    napi_get_value_int32(env, prop, &val);
    return val;
}

/**
 * create(options: object): boolean
 * 
 * Options:
 *   configPath: string (required)
 *   listenMode: 'none' | 'tcp' | 'unix' (default: 'none')
 *   tcpHost: string (for tcp mode)
 *   tcpPort: number (for tcp mode)
 *   unixPath: string (for unix mode)
 *   logLevel: number (0=DEBUG, 1=INFO, 2=WARN, 3=ERROR, default: 1)
 */
static napi_value fn_create(napi_env env, napi_callback_info info) {
    size_t argc = 1;
    napi_value args[1];
    napi_get_cb_info(env, info, &argc, args, NULL, NULL);
    
    if (argc < 1) {
        napi_throw_error(env, NULL, "options object required");
        return NULL;
    }
    
    napi_valuetype arg_type;
    napi_typeof(env, args[0], &arg_type);
    
    char *config_path = NULL;
    char *listen_mode_str = NULL;
    char *tcp_host = NULL;
    char *unix_path = NULL;
    int32_t tcp_port = 0;
    int32_t log_level = 1;
    stdio_bus_listen_mode_t listen_mode = STDIO_BUS_LISTEN_NONE;
    
    if (arg_type == napi_string) {
        /* Legacy: just config path string */
        size_t str_len;
        napi_get_value_string_utf8(env, args[0], NULL, 0, &str_len);
        config_path = malloc(str_len + 1);
        if (!config_path) {
            napi_throw_error(env, NULL, "Memory allocation failed");
            return NULL;
        }
        napi_get_value_string_utf8(env, args[0], config_path, str_len + 1, &str_len);
    } else if (arg_type == napi_object) {
        /* New: options object */
        config_path = get_string_property(env, args[0], "configPath");
        if (!config_path) {
            napi_throw_error(env, NULL, "configPath required in options");
            return NULL;
        }
        
        listen_mode_str = get_string_property(env, args[0], "listenMode");
        if (listen_mode_str) {
            if (strcmp(listen_mode_str, "tcp") == 0) {
                listen_mode = STDIO_BUS_LISTEN_TCP;
            } else if (strcmp(listen_mode_str, "unix") == 0) {
                listen_mode = STDIO_BUS_LISTEN_UNIX;
            }
            /* else: 'none' or unknown = STDIO_BUS_LISTEN_NONE */
        }
        
        tcp_host = get_string_property(env, args[0], "tcpHost");
        tcp_port = get_int32_property(env, args[0], "tcpPort", 0);
        unix_path = get_string_property(env, args[0], "unixPath");
        log_level = get_int32_property(env, args[0], "logLevel", 1);
    } else {
        napi_throw_error(env, NULL, "options must be string or object");
        return NULL;
    }
    
    /* Create state */
    if (g_state) {
        free(config_path);
        free(listen_mode_str);
        free(tcp_host);
        free(unix_path);
        napi_throw_error(env, NULL, "Bus already created");
        return NULL;
    }
    
    g_state = calloc(1, sizeof(addon_state_t));
    if (!g_state) {
        free(config_path);
        free(listen_mode_str);
        free(tcp_host);
        free(unix_path);
        napi_throw_error(env, NULL, "Memory allocation failed");
        return NULL;
    }
    
    g_state->env = env;
    
    /* Create stdio_bus */
    stdio_bus_options_t opts = {0};
    opts.config_path = config_path;
    opts.on_message = on_message_cb;
    opts.on_error = on_error_cb;
    opts.on_log = on_log_cb;
    opts.user_data = g_state;
    opts.log_level = log_level;
    
    /* Configure listener */
    opts.listener.mode = listen_mode;
    opts.listener.tcp_host = tcp_host;
    opts.listener.tcp_port = (uint16_t)tcp_port;
    opts.listener.unix_path = unix_path;
    
    g_state->bus = stdio_bus_create(&opts);
    
    /* Free allocated strings */
    free(config_path);
    free(listen_mode_str);
    free(tcp_host);
    free(unix_path);
    
    if (!g_state->bus) {
        free(g_state);
        g_state = NULL;
        napi_throw_error(env, NULL, "Failed to create stdio_bus");
        return NULL;
    }
    
    napi_value result;
    napi_get_boolean(env, true, &result);
    return result;
}

/**
 * start(): boolean
 */
static napi_value fn_start(napi_env env, napi_callback_info info) {
    (void)info;
    
    if (!g_state || !g_state->bus) {
        napi_throw_error(env, NULL, "Bus not created");
        return NULL;
    }
    
    int ret = stdio_bus_start(g_state->bus);
    
    napi_value result;
    napi_get_boolean(env, ret == STDIO_BUS_OK, &result);
    return result;
}

/**
 * send(message: string): boolean
 */
static napi_value fn_send(napi_env env, napi_callback_info info) {
    size_t argc = 1;
    napi_value args[1];
    napi_get_cb_info(env, info, &argc, args, NULL, NULL);
    
    if (!g_state || !g_state->bus) {
        napi_throw_error(env, NULL, "Bus not created");
        return NULL;
    }
    
    if (argc < 1) {
        napi_throw_error(env, NULL, "message required");
        return NULL;
    }
    
    /* Get message string */
    size_t str_len;
    napi_get_value_string_utf8(env, args[0], NULL, 0, &str_len);
    
    char *msg = malloc(str_len + 1);
    if (!msg) {
        napi_throw_error(env, NULL, "Memory allocation failed");
        return NULL;
    }
    
    napi_get_value_string_utf8(env, args[0], msg, str_len + 1, &str_len);
    
    int ret = stdio_bus_ingest(g_state->bus, msg, str_len);
    free(msg);
    
    napi_value result;
    napi_get_boolean(env, ret == STDIO_BUS_OK, &result);
    return result;
}

/**
 * poll(timeoutMs?: number): string[]
 * 
 * Pump the event loop and return queued messages.
 */
static napi_value fn_poll(napi_env env, napi_callback_info info) {
    size_t argc = 1;
    napi_value args[1];
    napi_get_cb_info(env, info, &argc, args, NULL, NULL);
    
    if (!g_state || !g_state->bus) {
        napi_throw_error(env, NULL, "Bus not created");
        return NULL;
    }
    
    /* Get timeout (default 0 = non-blocking) */
    int timeout_ms = 0;
    if (argc > 0) {
        napi_valuetype type;
        napi_typeof(env, args[0], &type);
        if (type == napi_number) {
            napi_get_value_int32(env, args[0], &timeout_ms);
        }
    }
    
    /* Pump the event loop */
    stdio_bus_step(g_state->bus, timeout_ms);
    
    /* Collect messages */
    napi_value messages;
    napi_create_array(env, &messages);
    
    uint32_t idx = 0;
    msg_node_t *node;
    while ((node = dequeue_message()) != NULL) {
        napi_value str;
        napi_create_string_utf8(env, node->data, node->len, &str);
        napi_set_element(env, messages, idx++, str);
        free_message(node);
    }
    
    return messages;
}

/**
 * stop(timeoutSec?: number): boolean
 */
static napi_value fn_stop(napi_env env, napi_callback_info info) {
    size_t argc = 1;
    napi_value args[1];
    napi_get_cb_info(env, info, &argc, args, NULL, NULL);
    
    if (!g_state || !g_state->bus) {
        napi_value result;
        napi_get_boolean(env, false, &result);
        return result;
    }
    
    int timeout_sec = 30;
    if (argc > 0) {
        napi_valuetype type;
        napi_typeof(env, args[0], &type);
        if (type == napi_number) {
            napi_get_value_int32(env, args[0], &timeout_sec);
        }
    }
    
    int ret = stdio_bus_stop(g_state->bus, timeout_sec);
    
    napi_value result;
    napi_get_boolean(env, ret == STDIO_BUS_OK, &result);
    return result;
}

/**
 * close(): void
 */
static napi_value fn_close(napi_env env, napi_callback_info info) {
    (void)info;
    
    if (g_state) {
        if (g_state->bus) {
            stdio_bus_destroy(g_state->bus);
            g_state->bus = NULL;
        }
        free(g_state);
        g_state = NULL;
    }
    
    /* Clear message queue */
    msg_node_t *node;
    while ((node = dequeue_message()) != NULL) {
        free_message(node);
    }
    
    napi_value undefined;
    napi_get_undefined(env, &undefined);
    return undefined;
}

/**
 * getState(): number
 */
static napi_value fn_get_state(napi_env env, napi_callback_info info) {
    (void)info;
    
    int state = STDIO_BUS_STATE_STOPPED;
    if (g_state && g_state->bus) {
        state = stdio_bus_get_state(g_state->bus);
    }
    
    napi_value result;
    napi_create_int32(env, state, &result);
    return result;
}

/**
 * getStats(): object
 */
static napi_value fn_get_stats(napi_env env, napi_callback_info info) {
    (void)info;
    
    napi_value stats;
    napi_create_object(env, &stats);
    
    if (g_state && g_state->bus) {
        stdio_bus_stats_t s;
        stdio_bus_get_stats(g_state->bus, &s);
        
        napi_value val;
        
        napi_create_int64(env, (int64_t)s.messages_in, &val);
        napi_set_named_property(env, stats, "messagesIn", val);
        
        napi_create_int64(env, (int64_t)s.messages_out, &val);
        napi_set_named_property(env, stats, "messagesOut", val);
        
        napi_create_int64(env, (int64_t)s.bytes_in, &val);
        napi_set_named_property(env, stats, "bytesIn", val);
        
        napi_create_int64(env, (int64_t)s.bytes_out, &val);
        napi_set_named_property(env, stats, "bytesOut", val);
        
        napi_create_int64(env, (int64_t)s.worker_restarts, &val);
        napi_set_named_property(env, stats, "workerRestarts", val);
        
        napi_create_int64(env, (int64_t)s.routing_errors, &val);
        napi_set_named_property(env, stats, "routingErrors", val);
        
        napi_create_int64(env, (int64_t)s.client_connects, &val);
        napi_set_named_property(env, stats, "clientConnects", val);
        
        napi_create_int64(env, (int64_t)s.client_disconnects, &val);
        napi_set_named_property(env, stats, "clientDisconnects", val);
    }
    
    return stats;
}

/**
 * getClientCount(): number
 * 
 * Returns the number of connected clients (TCP/Unix modes only).
 */
static napi_value fn_get_client_count(napi_env env, napi_callback_info info) {
    (void)info;
    
    int count = 0;
    if (g_state && g_state->bus) {
        count = stdio_bus_client_count(g_state->bus);
    }
    
    napi_value result;
    napi_create_int32(env, count, &result);
    return result;
}

/**
 * getWorkerCount(): number
 * 
 * Returns the number of running workers.
 */
static napi_value fn_get_worker_count(napi_env env, napi_callback_info info) {
    (void)info;
    
    int count = 0;
    if (g_state && g_state->bus) {
        count = stdio_bus_worker_count(g_state->bus);
    }
    
    napi_value result;
    napi_create_int32(env, count, &result);
    return result;
}

/*============================================================================
 * Module Initialization
 *============================================================================*/

static napi_value init(napi_env env, napi_value exports) {
    napi_property_descriptor props[] = {
        {"create", NULL, fn_create, NULL, NULL, NULL, napi_default, NULL},
        {"start", NULL, fn_start, NULL, NULL, NULL, napi_default, NULL},
        {"send", NULL, fn_send, NULL, NULL, NULL, napi_default, NULL},
        {"poll", NULL, fn_poll, NULL, NULL, NULL, napi_default, NULL},
        {"stop", NULL, fn_stop, NULL, NULL, NULL, napi_default, NULL},
        {"close", NULL, fn_close, NULL, NULL, NULL, napi_default, NULL},
        {"getState", NULL, fn_get_state, NULL, NULL, NULL, napi_default, NULL},
        {"getStats", NULL, fn_get_stats, NULL, NULL, NULL, napi_default, NULL},
        {"getClientCount", NULL, fn_get_client_count, NULL, NULL, NULL, napi_default, NULL},
        {"getWorkerCount", NULL, fn_get_worker_count, NULL, NULL, NULL, napi_default, NULL},
    };
    
    napi_define_properties(env, exports, sizeof(props) / sizeof(props[0]), props);
    
    /* Export state constants */
    napi_value val;
    
    napi_create_int32(env, STDIO_BUS_STATE_CREATED, &val);
    napi_set_named_property(env, exports, "STATE_CREATED", val);
    
    napi_create_int32(env, STDIO_BUS_STATE_STARTING, &val);
    napi_set_named_property(env, exports, "STATE_STARTING", val);
    
    napi_create_int32(env, STDIO_BUS_STATE_RUNNING, &val);
    napi_set_named_property(env, exports, "STATE_RUNNING", val);
    
    napi_create_int32(env, STDIO_BUS_STATE_STOPPING, &val);
    napi_set_named_property(env, exports, "STATE_STOPPING", val);
    
    napi_create_int32(env, STDIO_BUS_STATE_STOPPED, &val);
    napi_set_named_property(env, exports, "STATE_STOPPED", val);
    
    /* Export listen mode constants */
    napi_create_int32(env, STDIO_BUS_LISTEN_NONE, &val);
    napi_set_named_property(env, exports, "LISTEN_NONE", val);
    
    napi_create_int32(env, STDIO_BUS_LISTEN_TCP, &val);
    napi_set_named_property(env, exports, "LISTEN_TCP", val);
    
    napi_create_int32(env, STDIO_BUS_LISTEN_UNIX, &val);
    napi_set_named_property(env, exports, "LISTEN_UNIX", val);
    
    return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
