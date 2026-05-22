import React, { useState, useEffect } from 'react';
import { useAuth, API_BASE } from '../context/AuthContext';

export default function CustomerView() {
  const { authenticatedFetch } = useAuth();
  const [restaurants, setRestaurants] = useState([]);
  const [selectedRestaurant, setSelectedRestaurant] = useState(null);
  const [basket, setBasket] = useState([]);
  const [savedAddresses, setSavedAddresses] = useState([]);
  const [selectedAddressId, setSelectedAddressId] = useState('');
  const [customerOrders, setCustomerOrders] = useState([]);
  const [paymentMethod, setPaymentMethod] = useState('CARD');
  const [cardMock] = useState({ cardNumber: '400012345678', expiry: '12/28', cvv: '123' });
  // Поля нової адреси
  const [newStreet, setNewStreet] = useState('');
  const [newCity, setNewCity] = useState('');
  const [newPostalCode, setNewPostalCode] = useState('');
  const [isDefaultAddress, setIsDefaultAddress] = useState(false);

  const fetchCatalog = async () => {
    try {
      const res = await fetch(`${API_BASE}/catalog`);
      const data = await res.json();
      if (Array.isArray(data)) setRestaurants(data);
      console.log("Catalog loaded:", data);
    } catch (err) { console.error("Catalog download failure", err); }
  };

  const fetchCustomerOrders = async () => {
    try {
      const res = await authenticatedFetch(`${API_BASE}/orders/customer`);
      if (res && res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) setCustomerOrders(data);
        console.log("Customer orders loaded:", data);
      }
    } catch (e) { console.error(e); }
  };

  // МОДЕРНІЗАЦІЯ: Переведення на єдиний authenticatedFetch без ручного прокидання токенів
  const fetchCustomerAddresses = async () => {
    try {
      const res = await authenticatedFetch(`${API_BASE}/users/address`);
      if (res && res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          setSavedAddresses(data);
          const defAddress = data.find(a => a.isDefault) || data[0];
          if (defAddress) setSelectedAddressId(defAddress._id || defAddress.id);
        }
      }
    } catch (e) { console.error(e); }
  };

  useEffect(() => {
    fetchCatalog();
    fetchCustomerAddresses();
    fetchCustomerOrders();

    const interval = setInterval(() => {
      fetchCatalog();
      fetchCustomerOrders();
    }, 4000);

    return () => clearInterval(interval);
  }, []);

  const handleAddAddress = async (e) => {
    e.preventDefault();
    if (!newStreet || !newCity || !newPostalCode) return alert("Fill in all address fields");

    const res = await authenticatedFetch(`${API_BASE}/users/address`, {
      method: 'POST',
      body: JSON.stringify({ street: newStreet, city: newCity, postalCode: newPostalCode, isDefault: isDefaultAddress })
    });

    if (res && res.ok) {
      setNewStreet(''); setNewCity(''); setNewPostalCode(''); setIsDefaultAddress(false);
      fetchCustomerAddresses();
      alert("Address saved successfully!");
    }
  };

  const addToBasket = (item, restaurant) => {
    const resId = restaurant.restaurantId || restaurant.id;
    if (selectedRestaurant && selectedRestaurant.id !== resId) {
      return alert("Cannot mix selections across discrete restaurants! Clear item selection first.");
    }
    if (!selectedRestaurant) setSelectedRestaurant({ id: resId, name: restaurant.name });

    setBasket(prev => {
      const itemKey = item.dishId || item.id;
      const existing = prev.find(i => i.id === itemKey);
      if (existing) return prev.map(i => i.id === itemKey ? { ...i, quantity: i.quantity + 1 } : i);
      return [...prev, { id: itemKey, name: item.name, price: item.price, quantity: 1 }];
    });
  };
  const getCurrentCoordinates = () => {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("Геолокація не підтримується вашим браузером"));
      }
      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            lat: position.coords.latitude,
            lng: position.coords.longitude
          });
        },
        (error) => {
          reject(error);
        }
      );
    });
  };
  const getBasketTotal = () => basket.reduce((sum, item) => sum + (item.price * item.quantity), 0).toFixed(2);

  const handleCheckout = async () => {

    if (basket.length === 0 || !selectedAddressId) return alert("Please select an address and add items.");

    const activeAddress = savedAddresses.find(a => (a._id || a.id) === selectedAddressId);
    const addressString = activeAddress ? `${activeAddress.street}, ${activeAddress.city}, ${activeAddress.postalCode}` : "Default Station";
    const uniqueIdempotencyKey = `frontend_key_${Date.now()}_${Math.random()}`;

    // --- БЕЗПЕЧНЕ ОТРИМАННЯ КООРДИНАТ ---
    let deliveryCoords = { lat: 49.25, lng: 24.63 }; // Дефолт (Бурштин)
    try {
      deliveryCoords = await getCurrentCoordinates();
    } catch (err) {
      console.warn("Геолокація недоступна, використовуємо дефолтні координати:", err.message);
      // Можна додати alert("Геолокація вимкнена, використовуємо адресу за замовчуванням");
    }

    const res = await authenticatedFetch(`${API_BASE}/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Idempotency-Key': uniqueIdempotencyKey
      },
      body: JSON.stringify({
        restaurantId: selectedRestaurant.id,
        restaurantName: selectedRestaurant.name,
        restaurantAddress: selectedRestaurant.address || "Адреса не вказана",
        restaurantCoords: selectedRestaurant.coords || { lat: 49.25, lng: 24.63 }, // Безпечний fallback
        items: basket,
        deliveryAddress: addressString,
        deliveryCoords: deliveryCoords,
        paymentMethod: paymentMethod,
        paymentCardMock: paymentMethod === 'CARD' ? cardMock : null
      })
    });
    console.log("Checkout response:", selectedRestaurant);
    if (res && res.ok) {
      setBasket([]);
      setSelectedRestaurant(null);
      fetchCustomerOrders();
      alert("Order placed successfully!");
    } else {
      const errData = await res.json();
      alert(`Checkout failed: ${errData.error || 'Unknown error'}`);
    }
  };

  const getTargetReadyTime = (createdAtStr, preparingMinutes) => {
    if (!createdAtStr || !preparingMinutes) return null;

    const startTime = new Date(createdAtStr);
    const readyTime = new Date(startTime.getTime() + preparingMinutes * 60 * 1000);

    // Перевіряємо, чи замовлення вже мало бути готовим (строк минув)
    const isOverdue = new Date() > readyTime;

    // Форматуємо у красивий час HH:MM
    const hours = readyTime.getHours().toString().padStart(2, '0');
    const minutes = readyTime.getMinutes().toString().padStart(2, '0');

    return {
      formatted: `${hours}:${minutes}`,
      isOverdue
    };
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-6">
        {/* СЕКЦІЯ РЕСТОРАНІВ ТА МЕНЮ */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
          <h2 className="text-lg font-bold mb-5 text-slate-800 tracking-tight">Explore Restaurants & Menus</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {restaurants.map(r => (
              <div key={r._id || r.restaurantId} className="border border-slate-200 bg-slate-50/50 p-5 rounded-xl flex flex-col justify-between hover:shadow-md transition-shadow">

                {/* Хедер Ресторану (Логотип + Інфо) */}
                <div className="flex items-center space-x-4 pb-4 border-b border-slate-200">
                  <div className="w-14 h-14 rounded-full bg-white border border-slate-200 shadow-sm overflow-hidden flex-shrink-0 flex items-center justify-center">
                    <img
                      src={`${API_BASE.replace('/api/v1', '')}${r.logoUrl || '/uploads/default-logo.png'}`}
                      alt={`${r.name} Logo`}
                      className="w-full h-full object-cover"
                      onError={(e) => { e.target.src = 'https://placehold.co/100x100?text=Resto'; }}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-slate-900 truncate text-base">{r.name}</h3>
                    <span className="inline-block mt-1 bg-slate-200/80 text-slate-700 text-[11px] font-bold px-2 py-0.5 rounded-md">
                      {r.cuisine}
                    </span>
                  </div>
                </div>

                {/* Список страв цього ресторану */}
                <div className="space-y-3 mt-4 flex-1">
                  {r.menu?.map(item => (
                    <div key={item.dishId} className="flex items-center justify-between text-sm bg-white p-2 rounded-lg border border-slate-100 shadow-sm">

                      {/* Медіа-блок страви */}
                      <div className="flex items-center space-x-3 min-w-0 flex-1">
                        <div className="w-16 h-16 bg-slate-100 rounded-lg overflow-hidden flex-shrink-0 border border-slate-200/60">
                          <img
                            src={`${API_BASE.replace('/api/v1', '')}${item.imageUrl || '/uploads/default-dish.png'}`}
                            alt={item.name}
                            className="w-full h-full object-cover"
                            onError={(e) => { e.target.src = 'https://placehold.co/150x150?text=Food'; }}
                          />
                        </div>s
                        <div className="min-w-0">
                          <p className={`font-semibold truncate ${item.available ? "text-slate-800" : "text-slate-400 line-through"}`}>
                            {item.name}
                          </p>
                          <p className="text-xs font-mono font-bold text-emerald-600 mt-0.5">${item.price.toFixed(2)}</p>
                        </div>
                      </div>

                      {/* Кнопка дії */}
                      <div className="ml-2 flex-shrink-0">
                        {item.available ? (
                          <button
                            onClick={() => addToBasket(item, r)}
                            className="bg-slate-900 hover:bg-emerald-600 text-white hover:text-slate-950 font-bold text-xs px-3 py-1.5 rounded-md transition-colors shadow-sm"
                          >
                            + Add
                          </button>
                        ) : (
                          <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 bg-slate-100 px-2 py-1 rounded">
                            Out
                          </span>
                        )}
                      </div>

                    </div>
                  ))}
                </div>

              </div>
            ))}
          </div>
        </div>

        {/* КЕРУВАННЯ АДРЕСАМИ */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h3 className="text-sm font-black text-slate-800 mb-3 uppercase tracking-wider">Add New Address</h3>
            <form onSubmit={handleAddAddress} className="space-y-3">
              <input type="text" placeholder="Street Address" value={newStreet} onChange={e => setNewStreet(e.target.value)} className="w-full bg-white border border-slate-300 rounded p-2 text-sm focus:ring-2 focus:ring-emerald-400 focus:outline-none" />
              <div className="grid grid-cols-2 gap-2">
                <input type="text" placeholder="City" value={newCity} onChange={e => setNewCity(e.target.value)} className="w-full bg-white border border-slate-300 rounded p-2 text-sm focus:ring-2 focus:ring-emerald-400 focus:outline-none" />
                <input type="text" placeholder="Postal Code" value={newPostalCode} onChange={e => setNewPostalCode(e.target.value)} className="w-full bg-white border border-slate-300 rounded p-2 text-sm focus:ring-2 focus:ring-emerald-400 focus:outline-none" />
              </div>
              <label className="flex items-center space-x-2 text-xs font-bold text-slate-600 cursor-pointer uppercase select-none">
                <input type="checkbox" checked={isDefaultAddress} onChange={e => setIsDefaultAddress(e.target.checked)} className="rounded text-emerald-500 w-4 h-4 focus:ring-emerald-400" />
                <span>Default Address</span>
              </label>
              <button type="submit" className="w-full bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold py-2 rounded uppercase tracking-wide transition-colors">Save Address</button>
            </form>
          </div>
          <div className="border-t md:border-t-0 md:border-l border-slate-200 md:pl-6">
            <h3 className="text-sm font-black text-slate-800 mb-3 uppercase tracking-wider">Stored Addresses</h3>
            <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
              {savedAddresses.map(addr => {
                const id = addr._id || addr.id;
                return (
                  <label key={id} className={`block p-2.5 rounded-lg border text-xs cursor-pointer transition-all ${selectedAddressId === id ? 'border-emerald-500 bg-emerald-50/50 shadow-sm' : 'border-slate-200 bg-slate-50 hover:bg-slate-100'}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2 min-w-0">
                        <input type="radio" name="selected_addr" checked={selectedAddressId === id} onChange={() => setSelectedAddressId(id)} className="text-emerald-500 focus:ring-emerald-400" />
                        <span className="font-bold text-slate-800 truncate">{addr.street}, {addr.city}</span>
                      </div>
                      {addr.isDefault && <span className="bg-emerald-200 text-emerald-900 px-1.5 py-0.5 rounded text-[9px] font-black flex-shrink-0 ml-2">DEFAULT</span>}
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        </div>

        {/* ACTIVE PIPELINE TRACKER */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
          <h2 className="text-lg font-bold mb-4 text-slate-800 tracking-tight">Active Pipeline Tracker</h2>
          <div className="space-y-3">
            {customerOrders.map(o => (
              <div key={o.id} className="p-4 border border-slate-100 rounded-xl bg-slate-50 flex flex-col sm:flex-row justify-between sm:items-center gap-3 hover:border-slate-200 transition-colors">
                <div>
                  <div className="font-mono text-[10px] text-slate-400 font-bold">#{o.id}</div>
                  <div className="text-sm font-bold text-slate-800 mt-0.5">
                    ETA: {getTargetReadyTime(o.createdAt, o.estimatedPreparingTime + o.estimatedDeliveryTime)?.formatted || 'N/A'}
                  </div>
                  <div className="text-sm font-bold text-slate-800 mt-0.5">{o.restaurantName}</div>
                  <div className="text-xs text-slate-500 mt-0.5">📍 To: {o.deliveryAddress}</div>
                  {o.distanceKm !== undefined && (
                    <div className="text-[11px] text-emerald-600 font-semibold mt-1 flex items-center">
                      <span className="mr-1">🛣️</span> Маршрут: {o.distanceKm} км від ресторану

                    </div>
                  )}
                </div>
                <span className="w-fit px-3 py-1 rounded-full font-black text-[11px] uppercase tracking-wider bg-amber-100 text-amber-900 border border-amber-200/60 self-start sm:self-center">
                  {o.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* БОКОВИЙ КОШИК */}
      <div className="bg-slate-900 text-white p-6 rounded-xl shadow-xl flex flex-col justify-between h-fit sticky top-6 border border-slate-800">
        <div>
          <h2 className="text-lg font-bold border-b border-slate-800 pb-3 text-emerald-400 tracking-wide uppercase text-xs">Processing Basket</h2>
          {basket.length === 0 ? (
            <p className="text-slate-500 text-sm italic mt-4 text-center py-12">Cart is empty</p>
          ) : (
            <div className="space-y-3 mt-4 max-h-[60vh] overflow-y-auto pr-1">
              {basket.map((item, idx) => (
                <div key={idx} className="flex justify-between items-center text-sm border-b border-slate-800/60 pb-2">
                  <div className="min-w-0 pr-2">
                    <div className="font-bold truncate">{item.name}</div>
                    <div className="text-xs text-slate-400 mt-0.5">Qty: {item.quantity}</div>
                  </div>
                  <span className="font-mono text-emerald-400 font-bold flex-shrink-0">${(item.price * item.quantity).toFixed(2)}</span>
                </div>
              ))}
              <div className="flex justify-between items-center pt-4 font-black text-base border-t border-slate-700 mt-4">
                <span className="text-slate-300 text-sm uppercase">Total Value:</span>
                <span className="text-xl text-emerald-400 font-mono font-bold">${getBasketTotal()}</span>
              </div>
            </div>
          )}
        </div>
        <div className="mt-4 p-3 bg-slate-800 rounded-lg">
          <label className="text-xs font-bold text-slate-400 uppercase mb-2 block">Payment Method</label>
          <select
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value)}
            className="w-full bg-slate-700 text-white text-sm p-2 rounded border border-slate-600"
          >
            <option value="CARD">Credit Card (Test: 4000...)</option>
            <option value="CASH">Cash</option>
          </select>
        </div>
        <button
          onClick={handleCheckout}
          disabled={basket.length === 0 || !selectedAddressId}
          className="w-full mt-6 bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-black py-3 rounded-xl text-xs uppercase tracking-wider transition-colors shadow-lg shadow-emerald-500/10 disabled:shadow-none"
        >
          Execute Checkout
        </button>
      </div>
    </div>
  );
}