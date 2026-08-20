package main

func CreateOrder(userID string, items []string) (string, error) {
	orderID := generateOrderID()
	total := calculateTotal(items)

	err := chargePayment(userID, total)
	if err != nil {
		return "", err
	}

	return orderID, nil
}

func calculateTotal(items []string) int {
	total := 0
	for range items {
		total += 1000
	}
	return total
}
