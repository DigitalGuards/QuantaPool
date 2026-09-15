// Read-only contract-address prediction using the exact native go-qrl primitive.
package main

import (
	"fmt"
	"github.com/theQRL/go-qrl/common"
	"github.com/theQRL/go-qrl/crypto"
	"os"
	"strconv"
)

func main() {
	if len(os.Args) != 3 {
		panic("expected public address and nonce")
	}
	a, e := common.NewAddressFromString(os.Args[1])
	if e != nil {
		panic("invalid public address")
	}
	n, e := strconv.ParseUint(os.Args[2], 10, 64)
	if e != nil {
		panic("invalid nonce")
	}
	fmt.Println(crypto.CreateAddress(a, n).Hex())
}
