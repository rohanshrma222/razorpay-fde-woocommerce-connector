<?php
/**
 * Seeds the local WooCommerce dev store with fictional products/orders and
 * generates a read-only REST API key for the connector to use.
 * Run via: wp eval-file seed.php --allow-root --path=/var/www/html
 */

if (!function_exists('wc_get_product')) {
    fwrite(STDERR, "WooCommerce not loaded — is the plugin active?\n");
    exit(1);
}

if (!function_exists('wc_api_hash')) {
    function wc_api_hash($data) {
        return hash_hmac('sha256', $data, 'wc-api');
    }
}

// 1. Sample products (idempotent — skip if SKU already exists)
$product_ids = array();
$sample_products = array(
    array('name' => 'Fictional Wireless Mouse', 'price' => '19.99', 'sku' => 'DEMO-MOUSE-1'),
    array('name' => 'Fictional Mechanical Keyboard', 'price' => '59.99', 'sku' => 'DEMO-KEY-1'),
    array('name' => 'Fictional USB-C Hub', 'price' => '24.50', 'sku' => 'DEMO-HUB-1'),
);
foreach ($sample_products as $p) {
    $existing = wc_get_product_id_by_sku($p['sku']);
    if ($existing) {
        $product_ids[] = $existing;
        continue;
    }
    $product = new WC_Product_Simple();
    $product->set_name($p['name']);
    $product->set_regular_price($p['price']);
    $product->set_sku($p['sku']);
    $product->set_manage_stock(true);
    $product->set_stock_quantity(50);
    $product->set_status('publish');
    $product->save();
    $product_ids[] = $product->get_id();
}

// 2. Fictional orders with varied statuses (idempotent via a marker meta key)
global $wpdb;
$already_seeded = $wpdb->get_var("SELECT post_id FROM {$wpdb->postmeta} WHERE meta_key = '_mcp_demo_seed' LIMIT 1");
if (!$already_seeded) {
    $orders_spec = array(
        array('status' => 'processing', 'first' => 'Asha',   'last' => 'Rao',   'email' => 'asha.demo@example.test'),
        array('status' => 'completed',  'first' => 'Rahul',  'last' => 'Mehta', 'email' => 'rahul.demo@example.test'),
        array('status' => 'pending',    'first' => 'Priya',  'last' => 'Nair',  'email' => 'priya.demo@example.test'),
        array('status' => 'cancelled',  'first' => 'Vikram', 'last' => 'Shah',  'email' => 'vikram.demo@example.test'),
    );
    foreach ($orders_spec as $spec) {
        $order = wc_create_order();
        $order->set_billing_first_name($spec['first']);
        $order->set_billing_last_name($spec['last']);
        $order->set_billing_email($spec['email']);
        $order->add_product(wc_get_product($product_ids[array_rand($product_ids)]), 1);
        $order->calculate_totals();
        $order->set_status($spec['status']);
        $order->update_meta_data('_mcp_demo_seed', '1');
        $order->save();
    }
    echo "Created " . count($orders_spec) . " fictional orders.\n";
} else {
    echo "Fictional orders already seeded; skipping.\n";
}

// 3. Read-only REST API key (idempotent)
$table = $wpdb->prefix . 'woocommerce_api_keys';
$existing_key_id = $wpdb->get_var("SELECT key_id FROM $table WHERE description = 'mcp-connector' LIMIT 1");
if (!$existing_key_id) {
    $consumer_key = 'ck_' . bin2hex(random_bytes(20));
    $consumer_secret = 'cs_' . bin2hex(random_bytes(20));
    $wpdb->insert($table, array(
        'user_id'         => 1,
        'description'     => 'mcp-connector',
        'permissions'     => 'read',
        'consumer_key'    => wc_api_hash($consumer_key),
        'consumer_secret' => $consumer_secret,
        'truncated_key'   => substr($consumer_key, -7),
    ));
    echo "CONSUMER_KEY=$consumer_key\n";
    echo "CONSUMER_SECRET=$consumer_secret\n";
} else {
    echo "API key 'mcp-connector' already exists (key_id=$existing_key_id); not regenerating.\n";
    echo "If you need the secret again, delete the key in wp-admin (WooCommerce > Settings > Advanced > REST API) and rerun this script.\n";
}

echo "Product IDs: " . implode(',', $product_ids) . "\n";
echo "Seed complete.\n";
