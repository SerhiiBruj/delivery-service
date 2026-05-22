import React, { useState, useEffect } from 'react';
import { useAuth, API_BASE } from '../context/AuthContext';

export default function CourierView() {
  const { authenticatedFetch, user } = useAuth();
  const [availableTickets, setAvailableTickets] = useState([]);
  const [allTickets, setAllTickets] = useState([]);
  const [activeTab, setActiveTab] = useState('pool'); // 'pool' або 'my-delivery'

  // 1. Отримання ТІЛЬКИ вільних замовлень з нового логістичного пулу
  const fetchDeliveryPool = async () => {
    try {
      const res = await authenticatedFetch(`${API_BASE}/delivery/available-tickets`);
      if (res && res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) setAvailableTickets(data);
      }
    } catch (e) { 
      console.error("Помилка завантаження пулу доставки:", e); 
    }
  };

  // 2. Отримання загального списку для фільтрації замовлень
  const fetchAllTickets = async () => {
    try {
      const res = await authenticatedFetch(`${API_BASE}/kitchen/tickets`);
      if (res && res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) setAllTickets(data);
        console.log("Всі квитки кухні:", data);
      }
    } catch (e) { 
      console.error("Помилка завантаження історії квитків:", e); 
    }
  };

  const refreshData = () => {
    fetchDeliveryPool();
    fetchAllTickets();
  };

  useEffect(() => {
    refreshData();
    const interval = setInterval(refreshData, 4000);
    return () => clearInterval(interval);
  }, []);

  const updateTicketStatus = async (orderId, nextStatus) => {
    let payload = { status: nextStatus };

    if (nextStatus === 'PICKED_UP') {
      const timeInput = prompt("Вкажіть розрахунковий час доставки клієнту в хвилинах:", "25");
      if (timeInput === null) return; 
      
      const parsedTime = parseInt(timeInput, 10);
      if (isNaN(parsedTime) || parsedTime <= 0) {
        return alert("Будь ласка, вкажіть коректний час у хвилинах.");
      }
      payload.estimatedDeliveryTime = parsedTime;
    }

    try {
      const res = await authenticatedFetch(`${API_BASE}/kitchen/tickets/${orderId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res && res.ok) refreshData();
    } catch (e) {
      console.error("Помилка оновлення статусу логістики:", e);
    }
  };

  // ХЕЛПЕР: Розрахунок точного часу готовності (createdAt + estimatedPreparingTime)
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

  // Фільтруємо замовлення, які закріплені за поточним кур'єром
  const myDeliveryTickets = allTickets.filter(t => 
    t.courierId === user?.id && t.status === 'PICKED_UP'
  );

  return (
    <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
      {/* Навігація між вкладками */}
      <div className="flex border-b border-slate-200 mb-6 space-x-4">
        <button 
          onClick={() => setActiveTab('pool')}
          className={`pb-2 text-sm font-bold uppercase tracking-wider transition-colors focus:outline-none ${activeTab === 'pool' ? 'border-b-2 border-indigo-600 text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}
        >
          Вільні в пулі ({availableTickets.length})
        </button>
        <button 
          onClick={() => setActiveTab('my-delivery')}
          className={`pb-2 text-sm font-bold uppercase tracking-wider transition-colors focus:outline-none ${activeTab === 'my-delivery' ? 'border-b-2 border-emerald-500 text-emerald-500' : 'text-slate-400 hover:text-slate-600'}`}
        >
          В дорозі у мене ({myDeliveryTickets.length})
        </button>
      </div>

      {activeTab === 'pool' ? (
        <div>
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Доступні замовлення для доставки:</h3>
          {availableTickets.length === 0 ? (
            <p className="text-slate-400 text-sm italic py-4">Немає замовлень, очікуючих на кур'єра.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {availableTickets.map(ticket => {
                // Обчислюємо динамічний час готовності для кожного квитка
                const readyInfo = getTargetReadyTime(ticket.createdAt, ticket.estimatedPreparingTime);

                return (
                  <div key={ticket.orderId} className="border border-slate-200 rounded-xl p-4 bg-slate-50 flex justify-between items-center shadow-sm">
                    <div className="space-y-2 flex-1 pr-3">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[10px] text-slate-400 block font-bold">#{ticket.orderId}</span>
                        {/* МОДЕРНІЗАЦІЯ: Відображення відстані з бекенду */}
                        {ticket.distanceKm !== undefined && ticket.distanceKm !== null && (
                          <span className="bg-indigo-50 text-indigo-700 text-xs font-black px-2 py-0.5 rounded border border-indigo-100">
                            🏁 {ticket.distanceKm} км
                          </span>
                        )}
                      </div>
                      
                      <h4 className="font-black text-slate-800 text-base">{ticket.restaurantName}</h4>
                      
                      {/* МОДЕРНІЗАЦІЯ: Картка маршруту (Звідки -> Куди) */}
                      <div className="bg-white p-2.5 rounded-lg border border-slate-200 space-y-1.5 text-xs text-slate-700">
                        <p className="flex items-start">
                          <span className="mr-1.5 text-emerald-500 font-bold">🏪</span>
                          <span><b>Звідки (Пікап):</b> {ticket.restaurantAddress || 'Адреса закладу...'}</span>
                        </p>
                        <div className="h-2.5 border-l border-dashed border-slate-300 ml-2"></div>
                        <p className="flex items-start">
                          <span className="mr-1.5 text-rose-500 font-bold">📍</span>
                          <span><b>Куди (Доставка):</b> {ticket.deliveryAddress}</span>
                        </p>
                      </div>
                      
                      {/* МОДЕРНІЗАЦІЯ ЧАСУ: Вираховуємо точний час завершення приготування */}
                      {readyInfo && (
                        <p className={`text-[11px] mt-1.5 font-medium ${readyInfo.isOverdue ? 'text-rose-600' : 'text-emerald-600'}`}>
                          ⏰ {readyInfo.isOverdue ? 'Було готове о:' : 'Буде готове о:'} <b className="font-bold text-xs">{readyInfo.formatted}</b> 
                          <span className="text-[10px] text-slate-400 font-normal"> (з урахуванням {ticket.estimatedPreparingTime} хв на кухні)</span>
                        </p>
                      )}

                      <span className="inline-block mt-2 bg-blue-100 text-blue-800 text-[10px] font-black px-2.5 py-0.5 rounded uppercase">{ticket.status}</span>
                    </div>
                    <div>
                      <button 
                        onClick={() => updateTicketStatus(ticket.orderId, 'PICKED_UP')} 
                        className="bg-indigo-600 hover:bg-indigo-500 text-white font-black text-xs px-4 py-2.5 rounded-lg uppercase tracking-wider shadow-sm transition-colors whitespace-nowrap"
                      >
                        Забрати
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div>
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Ваш поточний маршрут:</h3>
          {myDeliveryTickets.length === 0 ? (
            <p className="text-slate-400 text-sm italic py-4">У вас немає активних доставок у дорозі.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {myDeliveryTickets.map(ticket => (
                <div key={ticket.orderId} className="border border-emerald-200 rounded-xl p-4 bg-emerald-50/20 flex justify-between items-center shadow-sm">
                  <div className="space-y-2 flex-1 pr-3">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px] text-slate-400 block font-bold">#{ticket.orderId}</span>
                      {ticket.distanceKm !== undefined && ticket.distanceKm !== null && (
                        <span className="bg-emerald-100 text-emerald-800 text-xs font-black px-2 py-0.5 rounded">
                          📏 {ticket.distanceKm} км
                        </span>
                      )}
                    </div>
                    
                    <h4 className="font-black text-slate-800 text-base">{ticket.restaurantName}</h4>
                    
                    {/* МОДЕРНІЗАЦІЯ: Маршрут у вкладці активної доставки */}
                    <div className="bg-white p-2.5 rounded-lg border border-emerald-100/60 space-y-1.5 text-xs text-slate-700">
                      <p className="flex items-start">
                        <span className="mr-1.5 text-emerald-500 font-bold">🏪</span>
                        <span><b>Заклад (Пікап):</b> {ticket.restaurantAddress || 'Адреса закладу...'}</span>
                      </p>
                      <div className="h-2.5 border-l border-dashed border-slate-300 ml-2"></div>
                      <p className="flex items-start">
                        <span className="mr-1.5 text-rose-500 font-bold">📍</span>
                        <span><b>Доставити на:</b> {ticket.deliveryAddress}</span>
                      </p>
                    </div>

                    <span className="inline-block mt-2 bg-amber-100 text-amber-800 text-[10px] font-black px-2.5 py-0.5 rounded uppercase">{ticket.status}</span>
                  </div>
                  <div>
                    <button 
                      onClick={() => updateTicketStatus(ticket.orderId, 'DELIVERED')} 
                      className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs px-4 py-2.5 rounded-lg uppercase tracking-wider shadow-sm transition-colors whitespace-nowrap"
                    >
                      Доставлено
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}