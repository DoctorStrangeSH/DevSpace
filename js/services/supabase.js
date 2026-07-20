/* ============================================
   SUPABASE SERVICE (заглушка)
   Чтобы включить:
   1. Создай проект на supabase.com
   2. Замени SUPABASE_URL и SUPABASE_KEY
   3. Поставь SUPABASE_ENABLED = true
   ============================================ */

var SUPABASE_ENABLED = false;
var SUPABASE_URL = 'https://YOUR_PROJECT.supabase.co';
var SUPABASE_KEY = 'YOUR_ANON_KEY';

var SupabaseService = {
    _client: null,

    init: function() {
        if (!SUPABASE_ENABLED) {
            console.log('Supabase: отключен');
            return;
        }
        console.log('Supabase: готов к работе (включи SUPABASE_ENABLED)');
    },

    isEnabled: function() {
        return SUPABASE_ENABLED;
    }
};

window.SupabaseService = SupabaseService;