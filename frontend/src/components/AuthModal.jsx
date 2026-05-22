import React, { useState } from 'react';
import { useAuth, API_BASE } from '../context/AuthContext';

export default function AuthModal() {
  const { login } = useAuth();
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('Customer');

  // Адаптація: Нові обов'язкові стейти для ПД користувача
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  // Стейти для специфічних полів ресторану
  const [restaurantName, setRestaurantName] = useState('');
  const [cuisine, setCuisine] = useState('');
  const [street, setStreet] = useState('');
  const [city, setCity] = useState('');
  const [postalCode, setPostalCode] = useState('');

  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const validateForm = () => {
    if (!email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
      setError('Введіть коректну email адресу');
      return false;
    }
    if (password.length < 6) {
      setError('Пароль має містити не менше 6 символів');
      return false;
    }

    // Адаптація: Валідація нових обов'язкових полів при реєстрації
    if (!isLogin) {
      if (!name.trim()) {
        setError("Введіть ваше ім'я");
        return false;
      }
      if (!phone.trim()) {
        setError('Введіть ваш номер телефону');
        return false;
      }
    }

    // Адаптація: Перевірка ролі 'Restaurant Manager' відповідно до оновленого enum
    if (!isLogin && role === 'Restaurant Manager') {
      if (!restaurantName.trim() || !cuisine.trim() || !street.trim() || !city.trim() || !postalCode.trim()) {
        setError('Будь ласка, заповніть усі поля щодо ресторану та його адреси');
        return false;
      }
    }
    return true;
  };
  const handleGetLocation = async () => {
    try {
      const coords = await getCurrentCoordinates();
      setLat(coords.lat);
      setLng(coords.lng);
      alert("Координати зафіксовано!");
    } catch (err) {
      alert("Не вдалося отримати координати. Введіть вручну.");
    }
  };
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!validateForm()) return;

    setSubmitting(true);
    const endpoint = isLogin ? '/users/login' : '/users/register';

    // Формування динамічного payload
    let payload = { email, password };

    if (!isLogin) {
      // Адаптація: Передаємо нові поля на сервер
      payload.name = name.trim();
      payload.phone = phone.trim();
      payload.role = role;

      if (role === 'Restaurant Manager') {
        payload = {
          ...payload,
          restaurantName,
          cuisine,
          street,
          city,
          postalCode
        };
      }
    }

    try {
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || data.error || 'Сталася помилка при автентифікації');
      }

      // Якщо це успішна реєстрація без миттєвого токена — автоматично логінимо
      if (!isLogin && !data.accessToken) {
        const loginRes = await fetch(`${API_BASE}/users/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });
        const loginData = await loginRes.json();

        if (loginRes.ok) {
          // ВИПРАВЛЕНО: Передаємо повний заповнений об'єкт loginData.user прямо з бекенду
          login(loginData.user, loginData.accessToken, loginData.refreshToken);
        } else {
          setIsLogin(true);
          setError('Реєстрація успішна! Увійдіть, будь ласка.');
        }
      } else if (data.accessToken) {
        // ВИПРАВЛЕНО: Для звичайного логіну так само передаємо чистий об'єкт data.user із бази
        login(data.user, data.accessToken, data.refreshToken);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 px-4 py-8">
      <div className="bg-white p-8 rounded-2xl shadow-xl border border-slate-200 max-w-md w-full transition-all">
        <div className="text-center mb-6">
          <span className="text-2xl font-black tracking-wider text-emerald-500">HYPER_FEED</span>
          <h2 className="text-xl font-bold text-slate-800 mt-2">
            {isLogin ? 'Вхід у систему' : 'Створення акаунта'}
          </h2>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-rose-50 border-l-4 border-rose-500 text-rose-800 text-xs font-semibold rounded">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Нові поля ПД для реєстрації */}
          {!isLogin && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Ім'я</label>
                <input
                  type="text"
                  required
                  placeholder="Олексій"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Телефон</label>
                <input
                  type="text"
                  required
                  placeholder="+380..."
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Email</label>
            <input
              type="email"
              required
              placeholder="your@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Пароль</label>
            <input
              type="password"
              required
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
            />
          </div>

          {!isLogin && (
            <>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Оберіть Роль</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 font-medium text-slate-700"
                >
                  <option value="Customer">Customer</option>
                  {/* Адаптація: Значення опції тепер строго відповідає enum 'Restaurant Manager' */}
                  <option value="Restaurant Manager">Restaurant Manager</option>
                  <option value="Courier">Courier</option>
                  <option value="admin">Admin</option>
                </select>
              </div>

              {/* Специфічна секція полів для Restaurant Manager */}
              {role === 'Restaurant Manager' && (
                <div className="pt-2 mt-2 border-t border-dashed border-slate-200 space-y-3">
                  <p className="text-xs font-bold text-emerald-600 uppercase tracking-wide">Дані ресторану</p>

                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Назва ресторану</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Tomato & Basil"
                      value={restaurantName}
                      onChange={(e) => setRestaurantName(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Тип кухні</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Italian, Asian"
                      value={cuisine}
                      onChange={(e) => setCuisine(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Місто</label>
                      <input
                        type="text"
                        required
                        placeholder="Київ"
                        value={city}
                        onChange={(e) => setCity(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Поштовий індекс</label>
                      <input
                        type="text"
                        required
                        placeholder="01001"
                        value={postalCode}
                        onChange={(e) => setPostalCode(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Вулиця, будинок</label>
                    <input
                      type="text"
                      required
                      placeholder="вул. Хрещатик, 12"
                      value={street}
                      onChange={(e) => setStreet(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                    />
                  </div>
                  {role === 'Restaurant Manager' && (
                    <button type="button" onClick={handleGetLocation} className="text-xs bg-emerald-100 text-emerald-800 p-2 rounded">
                      Визначити координати автоматично
                    </button>
                  )}
                </div>
              )}
            </>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full mt-2 bg-slate-900 hover:bg-slate-800 text-white font-bold py-3 px-4 rounded-lg uppercase tracking-wider text-xs shadow-md transition-all disabled:opacity-50"
          >
            {submitting ? 'Обробка...' : isLogin ? 'Увійти' : 'Зареєструватися'}
          </button>
        </form>

        <div className="mt-6 text-center border-t border-slate-100 pt-4">
          <button
            onClick={() => { setIsLogin(!isLogin); setError(''); }}
            className="text-xs font-bold text-emerald-600 hover:text-emerald-700 uppercase tracking-wide"
          >
            {isLogin ? 'Немає акаунта? Реєстрація' : 'Вже є акаунт? Увійти'}
          </button>
        </div>
      </div>
    </div>
  );
}