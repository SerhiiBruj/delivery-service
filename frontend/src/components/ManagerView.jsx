import React, { useState, useEffect } from 'react';
import { useAuth, API_BASE } from '../context/AuthContext';

export default function ManagerView() {
  const { authenticatedFetch, user } = useAuth();
  const [kitchenTickets, setKitchenTickets] = useState([]);
  
  const [restaurantId, setRestaurantId] = useState('');
  const [restaurantName, setRestaurantName] = useState('');
  const [cuisine, setCuisine] = useState('');
  
  const [dishName, setDishName] = useState('');
  const [dishPrice, setDishPrice] = useState('');

  const [logoFile, setLogoFile] = useState(null);
  const [dishImageFile, setDishImageFile] = useState(null);

  // ВИКОРИСТОВУЄМО ДАНІ З ЛОГІНУ НАПРЯМУ: Стейт заповнюється миттєво без затримок
  useEffect(() => {
    if (user) {
      const profile = user.restaurantProfile || {};
      setRestaurantId(profile.restaurantId || user.id || '');
      setRestaurantName(profile.name || user.restaurantName || '');
      setCuisine(profile.cuisine || user.cuisine || '');
    }
  }, [user]);

  const fetchKitchenTickets = async () => {
    try {
      const res = await authenticatedFetch(`${API_BASE}/kitchen/tickets`);
      if (res && res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) setKitchenTickets(data);
      }
    } catch (e) { 
      console.error("Помилка завантаження замовлень кухні:", e); 
    }
  };

  useEffect(() => {
    fetchKitchenTickets();
    const interval = setInterval(fetchKitchenTickets, 4000);
    return () => clearInterval(interval);
  }, []);

  const handleAddMenuItem = async (e) => {
    e.preventDefault();
    if (!dishName.trim() || !dishPrice) return alert("Заповніть назву та ціну страви");
    if (!restaurantId) return alert("Помилка ідентифікації ресторану.");

    // Валідація: Тепер ці поля точно заповнені з об'єкта логіну
    if (!restaurantName.trim() || !cuisine.trim()) {
      return alert("Помилка: Назва ресторану або тип кухні не знайдені в сесії. Будь ласка, перезайдіть в акаунт.");
    }

    const formData = new FormData();
    formData.append('restaurantId', restaurantId);
    formData.append('restaurantName', restaurantName.trim());
    formData.append('cuisine', cuisine.trim());

    const menuItems = [{ 
      dishId: "dish_" + Date.now(), 
      name: dishName.trim(), 
      price: parseFloat(dishPrice), 
      available: true 
    }];
    formData.append('menuItems', JSON.stringify(menuItems));

    if (logoFile) formData.append('logo', logoFile);
    if (dishImageFile) formData.append('dishImage', dishImageFile);

    try {
      const res = await fetch(`${API_BASE}/catalog/menu`, { 
        method: 'POST', 
        headers: {
          'x-user-id': user.id,
          'x-user-role': user.role,
        },
        body: formData 
      });
      
      if (res && res.ok) {
        setDishName(''); 
        setDishPrice('');
        setDishImageFile(null);
        setLogoFile(null);
        
        if (document.getElementById('dishImageInput')) document.getElementById('dishImageInput').value = '';
        if (document.getElementById('logoImageInput')) document.getElementById('logoImageInput').value = '';
        
        alert("Страву успішно опубліковано!");
      } else {
        const errData = await res.json();
        alert(`Помилка публікації: ${errData.error || 'Невідома помилка'}`);
      }
    } catch (err) {
      console.error(err);
      alert("Не вдалося зв'язатися з сервером каталогу");
    }
  };

  const updateTicketStatus = async (orderId, nextStatus) => {
    let payload = { status: nextStatus };

    if (nextStatus === 'READY_FOR_PICKUP') {
      let isValid = false;
      let timeInput = null;

      while (!isValid) {
        timeInput = prompt("Вкажіть час приготування (хв):", "15");
        if (timeInput === null) return; 

        const parsedTime = parseInt(timeInput, 10);
        if (!isNaN(parsedTime) && parsedTime > 0) {
          payload.estimatedPreparingTime = parsedTime;
          isValid = true;
        } else {
          alert("Вкажіть число більше за 0.");
        }
      }
    }

    try {
      const res = await authenticatedFetch(`${API_BASE}/kitchen/tickets/${orderId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res && res.ok) fetchKitchenTickets();
    } catch (e) {
      console.error(e);
    }
  };

  const preparingTickets = kitchenTickets.filter(t => 
    t.status === 'PREPARING' && t.restaurantId === restaurantId
  );

  return (
    <div className="space-y-6">
      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
        <div className="flex justify-between items-center mb-4">
          <div>
            <h2 className="text-lg font-bold text-slate-800">Керування меню ресторану</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Ресторан: <span className="font-semibold text-slate-700">{restaurantName || 'Завантаження назви...'}</span> ({cuisine || 'кухня...'})
            </p>
          </div>
          <span className="text-[10px] bg-slate-100 border font-mono px-2 py-1 rounded text-slate-600">
            ID: {restaurantId || 'завантаження...'}
          </span>
        </div>

        <form onSubmit={handleAddMenuItem} className="space-y-4 bg-slate-50 p-4 rounded-lg">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Оновити Логотип Ресторану (Опціонально)</label>
              <input id="logoImageInput" type="file" accept="image/*" onChange={e => setLogoFile(e.target.files[0])} className="w-full bg-white border border-slate-300 rounded p-1.5 text-xs focus:outline-none" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Фотографії страви</label>
              <input id="dishImageInput" type="file" accept="image/*" onChange={e => setDishImageFile(e.target.files[0])} className="w-full bg-white border border-slate-300 rounded p-1.5 text-xs focus:outline-none" />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            <div className="md:col-span-1">
              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Назва страви</label>
              <input type="text" placeholder="Піца..." value={dishName} onChange={e => setDishName(e.target.value)} className="w-full bg-white border border-slate-300 rounded p-2 text-xs focus:ring-2 focus:ring-emerald-400 focus:outline-none" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Ціна ($)</label>
              <input type="number" step="0.01" placeholder="0.00" value={dishPrice} onChange={e => setDishPrice(e.target.value)} className="w-full bg-white border border-slate-300 rounded p-2 text-xs font-mono focus:ring-2 focus:ring-emerald-400 focus:outline-none" />
            </div>
            <div>
              <button type="submit" className="w-full bg-emerald-500 hover:bg-emerald-600 text-slate-950 text-xs font-black h-[34px] rounded uppercase tracking-wider transition-colors">
                Опублікувати з фото
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* ЧЕРГА КУХНІ */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
        <h2 className="text-lg font-bold mb-4 text-slate-800">Черга кухні (PREPARING)</h2>
        {preparingTickets.length === 0 ? (
          <p className="text-slate-400 text-sm italic">Немає активних замовлень.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {preparingTickets.map(ticket => (
              <div key={ticket.orderId} className="border border-slate-200 rounded-xl p-4 bg-slate-50 flex flex-col justify-between">
                <div>
                  <div className="flex justify-between items-center border-b pb-2 mb-2">
                    <span className="font-mono text-xs text-slate-500 font-bold">#{ticket.orderId}</span>
                    <span className="bg-orange-500 text-white text-[10px] font-black px-2 py-0.5 rounded-full">{ticket.status}</span>
                  </div>
                  <ul className="text-sm space-y-1 text-slate-700 mb-4">
                    {ticket.items?.map((i, idx) => (
                      <li key={idx}>• {i.name} <span className="text-xs text-slate-400 font-bold">(x{i.quantity})</span></li>
                    ))}
                  </ul>
                </div>
                <button onClick={() => updateTicketStatus(ticket.orderId, 'READY_FOR_PICKUP')} className="w-full bg-slate-900 hover:bg-emerald-500 hover:text-slate-950 text-white font-bold text-xs py-2 rounded-lg uppercase tracking-wide transition-all">
                  Готово до видачі
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}